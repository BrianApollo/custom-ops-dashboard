import { settings } from '../env'
import { credential, noteTokenError, type Credential } from '../facebook/credentials'
import { addDays, today } from '../lib/dates'
import { nowIso, rows, sql } from '../lib/d1'
import type { FbObject } from '../lib/facebook'
import { recordId } from '../lib/ids'
import { newBudget, parseAction, parseCondition, roasMatches, type Action, type Condition } from './ruleText'

// Scaling rules: each night every rule looks at the ROAS of the active
// campaigns it covers for its last N days, and acts on the ones that pass on
// every one of those days. Runs with the Master Profile's token.

const PAUSE_MS = 500

interface Rule {
  id: string
  name: string
  scoped: boolean
  // Facebook ids of the campaigns a scoped rule is linked to
  fbCampaignIds: string[]
  selectType: string
  condition: Condition | null
  action: Action | null
}

interface Campaign {
  id: string
  name: string
  dailyBudget: number
}

export interface ActionResult {
  campaignId: string
  campaignName: string
  action: string
  previousValue: number | string
  newValue: number | string
  success: boolean
  error?: string
}

export type RuleStatus = 'Success' | 'Partial' | 'Failed' | 'No Match' | 'Dry Run'

export interface RuleResult {
  ruleId: string
  ruleName: string
  status: RuleStatus
  campaignsEvaluated: number
  campaignsMatched: number
  actions: ActionResult[]
  error?: string
  durationMs: number
}

export interface RulesOptions {
  ruleId?: string
  dryRun?: boolean
}

export async function runScalingRules({ ruleId, dryRun = false }: RulesOptions = {}) {
  const rules = await loadRules(ruleId)
  if (!rules.length) return { dryRun, rules: [] as RuleResult[] }

  const started = Date.now()
  let data: Awaited<ReturnType<typeof loadFacebook>>
  let master: Credential | undefined
  try {
    master = await credential(undefined)
    data = await loadFacebook(master, rules)
  } catch (error) {
    if (master) await noteTokenError(master, error)
    // nothing could be evaluated; every rule records why
    const message = error instanceof Error ? error.message : String(error)
    const results = rules.map((rule) => failed(rule, message, Date.now() - started))
    await Promise.all(results.map(log))
    return { dryRun, rules: results }
  }

  const results: RuleResult[] = []
  for (const rule of rules) {
    const ruleStarted = Date.now()
    let result: RuleResult
    try {
      result = await evaluate(rule, master, data, dryRun)
    } catch (error) {
      result = failed(rule, error instanceof Error ? error.message : String(error), 0)
    }
    result.durationMs = Date.now() - ruleStarted
    await log(result)
    results.push(result)
  }
  console.log(`[executor] ${rules.length} scaling rule(s)${dryRun ? ' (dry run)' : ''} in ${Date.now() - started} ms`)
  return { dryRun, rules: results }
}

async function loadRules(ruleId?: string): Promise<Rule[]> {
  const found = await rows(
    sql(
      `SELECT r.id, r.name, r.rule_scope, r.select_type, r.if_condition, r.then_action,
              (SELECT json_group_array(c.fb_campaign_id) FROM scaling_rule_campaigns j
                 JOIN campaigns c ON c.id = j.campaign_id
                WHERE j.scaling_rule_id = r.id AND coalesce(c.fb_campaign_id, '') <> '') AS fb_campaign_ids
       FROM scaling_rules r
       WHERE ?1 IS NULL OR r.id = ?1
       ORDER BY r.created_at, r.id`,
      ruleId ?? null,
    ),
  )
  return found.map((row) => ({
    id: row.id as string,
    name: (row.name as string | null) ?? '',
    // no scope means global, as it always has
    scoped: row.rule_scope === 'Scoped',
    fbCampaignIds: JSON.parse((row.fb_campaign_ids as string | null) ?? '[]') as string[],
    selectType: (row.select_type as string | null) ?? '',
    condition: parseCondition(row.if_condition),
    action: parseAction(row.then_action),
  }))
}

// Active campaigns of every active ad account, and each one's ROAS by day
async function loadFacebook({ client }: Credential, rules: Rule[]) {
  const date = today(settings.TEAM_TIME_ZONE ?? 'Asia/Bangkok')
  const maxDays = Math.max(1, ...rules.map((rule) => rule.condition?.days ?? 0))
  const since = addDays(date, -maxDays)
  const until = addDays(date, -1)

  const accounts = (await client.list('me/adaccounts', { fields: 'id,account_status', limit: 100 })).filter(
    (account) => account.account_status === 1,
  )

  const campaigns: Campaign[] = []
  const roas = new Map<string, Map<string, number>>()
  await Promise.all(
    accounts.map(async (account) => {
      try {
        const [found, insights] = await Promise.all([
          client.list(`${account.id}/campaigns`, { fields: 'id,name,daily_budget', effective_status: ['ACTIVE'], limit: 100 }),
          client.list(`${account.id}/insights`, {
            level: 'campaign',
            fields: 'campaign_id,purchase_roas,spend',
            time_range: { since, until },
            time_increment: 1,
            filtering: [{ field: 'campaign.effective_status', operator: 'IN', value: ['ACTIVE'] }],
            limit: 500,
          }),
        ])
        for (const campaign of found) {
          campaigns.push({ id: campaign.id, name: campaign.name ?? '', dailyBudget: parseInt(campaign.daily_budget ?? '0', 10) || 0 })
        }
        for (const row of insights) addRoas(roas, row)
      } catch (error) {
        // one account Facebook will not answer for does not stop the others
        console.error(`[executor] could not read ${account.id}:`, error)
      }
    }),
  )
  return { date, campaigns, roas }
}

// A day Facebook has a row for had delivery; no purchase_roas there means no
// purchases, so ROAS 0. A day with no row has no data and never matches.
function addRoas(roas: Map<string, Map<string, number>>, row: FbObject) {
  const value = parseFloat(row.purchase_roas?.[0]?.value ?? '0')
  let daily = roas.get(row.campaign_id)
  if (!daily) roas.set(row.campaign_id, (daily = new Map()))
  daily.set(row.date_start, Number.isFinite(value) ? value : 0)
}

async function evaluate(rule: Rule, master: Credential, data: Awaited<ReturnType<typeof loadFacebook>>, dryRun: boolean): Promise<RuleResult> {
  if (rule.selectType === 'Maximum Global Budget') throw new Error('Maximum Global Budget rules are not supported')
  if (!rule.condition || !rule.action) throw new Error(`Rule "${rule.name}" has no parseable condition or action`)

  const targets = rule.scoped ? data.campaigns.filter((c) => rule.fbCampaignIds.includes(c.id)) : data.campaigns
  const dates = Array.from({ length: rule.condition.days }, (_, i) => addDays(data.date, i - rule.condition!.days))
  const matched = targets.filter((c) => roasMatches(rule.condition!, data.roas.get(c.id), dates))

  const actions: ActionResult[] = []
  for (const campaign of matched) {
    const result = await act(master, campaign, rule.action, dryRun)
    if (!result) continue
    actions.push(result)
    if (!dryRun) await new Promise((resolve) => setTimeout(resolve, PAUSE_MS))
  }

  return {
    ruleId: rule.id,
    ruleName: rule.name,
    status: status(actions, dryRun),
    campaignsEvaluated: targets.length,
    campaignsMatched: matched.length,
    actions,
    durationMs: 0,
  }
}

// null when the action does not apply, such as a budget change on a campaign
// whose budget is set on its ad sets
async function act(master: Credential, campaign: Campaign, action: Action, dryRun: boolean): Promise<ActionResult | null> {
  let change: Record<string, unknown>
  let previousValue: number | string
  let newValue: number | string
  if (action.type === 'turn_off') {
    change = { status: 'PAUSED' }
    previousValue = 'ACTIVE'
    newValue = 'PAUSED'
  } else {
    if (!campaign.dailyBudget) return null
    const cents = newBudget(campaign.dailyBudget, action)!
    change = { daily_budget: cents }
    previousValue = campaign.dailyBudget
    newValue = cents
  }

  const result: ActionResult = { campaignId: campaign.id, campaignName: campaign.name, action: action.type, previousValue, newValue, success: true }
  if (dryRun) return result
  try {
    await master.client.post(campaign.id, change)
  } catch (error) {
    await noteTokenError(master, error)
    result.success = false
    result.error = error instanceof Error ? error.message : String(error)
  }
  return result
}

function status(actions: ActionResult[], dryRun: boolean): RuleStatus {
  if (dryRun) return 'Dry Run'
  if (!actions.length) return 'No Match'
  if (actions.every((a) => a.success)) return 'Success'
  if (actions.every((a) => !a.success)) return 'Failed'
  return 'Partial'
}

const failed = (rule: Rule, error: string, durationMs: number): RuleResult => ({
  ruleId: rule.id,
  ruleName: rule.name,
  status: 'Failed',
  campaignsEvaluated: 0,
  campaignsMatched: 0,
  actions: [],
  error,
  durationMs,
})

// one row per rule per run; a failure to write is reported, never thrown
async function log(result: RuleResult) {
  const at = nowIso()
  try {
    await sql(
      `INSERT INTO rule_execution_log
         (id, rule_name, rule_id, executed_at, campaigns_evaluated, campaigns_matched, duration_ms, actions_taken, status, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      recordId(),
      result.ruleName,
      result.ruleId,
      at,
      result.campaignsEvaluated,
      result.campaignsMatched,
      result.durationMs,
      JSON.stringify(result.actions),
      result.status,
      result.error ?? null,
      at,
      at,
    ).run()
  } catch (error) {
    console.error(`[executor] could not log rule ${result.ruleId}:`, error)
  }
}
