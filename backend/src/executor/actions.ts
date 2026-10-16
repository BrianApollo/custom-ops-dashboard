import { settings } from '../env'
import { credential, noteTokenError, type Credential } from '../facebook/credentials'
import { today } from '../lib/dates'
import { nowIso, rows, sql } from '../lib/d1'
import { ApiError } from '../lib/errors'

// Scheduled actions: one-off budget or status changes made from the Manage and
// Schedules pages. Every Pending row dated today or earlier (team calendar) runs
// with the Master Profile's token.

// A row left Running this long was cut off mid-run. Setting a budget or a
// status to a fixed value can safely happen twice, so it goes back to Pending.
const STALE_MS = 60 * 60 * 1000

interface Claimed {
  id: string
  fbCampaignId: string | null
  type: string | null
  execute: string | null
}

export interface ActionsSummary {
  date: string
  total: number
  success: number
  failed: number
}

export async function runScheduledActions(): Promise<ActionsSummary> {
  const date = today(settings.TEAM_TIME_ZONE ?? 'Asia/Bangkok')
  // before claiming, so a missing Master Profile leaves every row Pending for the next run
  const master = await credential(undefined)

  const now = nowIso()
  await sql(
    `UPDATE schedule SET status = 'Pending', updated_at = ? WHERE status = 'Running' AND updated_at < ?`,
    now,
    new Date(Date.now() - STALE_MS).toISOString(),
  ).run()

  // Claiming is one statement, so two overlapping runs never both get a row.
  // Imported rows may carry a time after the date, hence substr.
  const claimed = (await rows(
    sql(
      `UPDATE schedule SET status = 'Running', updated_at = ?1
       WHERE status = 'Pending' AND substr(scheduled_at, 1, 10) <= ?2
       RETURNING id, fb_campaign_id AS fbCampaignId, type, execute`,
      now,
      date,
    ),
  )) as unknown as Claimed[]

  const results = await Promise.all(claimed.map((action) => runAction(master, action, date)))
  const success = results.filter(Boolean).length
  console.log(`[executor] scheduled actions for ${date}: ${claimed.length} run, ${success} succeeded`)
  return { date, total: claimed.length, success, failed: claimed.length - success }
}

async function runAction(master: Credential, action: Claimed, date: string) {
  let status = 'Failed'
  let response: unknown
  try {
    response = await apply(master, action)
    status = 'Success'
  } catch (error) {
    await noteTokenError(master, error)
    response = errorBody(error)
  }
  try {
    const at = nowIso()
    await sql(
      `UPDATE schedule SET status = ?, executed_at = ?, response = ?, response_updated_at = ?, updated_at = ? WHERE id = ?`,
      status,
      date,
      JSON.stringify(response),
      at,
      at,
      action.id,
    ).run()
  } catch (error) {
    // the row stays Running and is picked up again once stale
    console.error(`[executor] could not record the result of ${action.id}:`, error)
  }
  return status === 'Success'
}

async function apply(master: Credential, { fbCampaignId, type, execute }: Claimed) {
  if (!fbCampaignId || !type || !execute) throw new Error('Missing required fields: Campaign Id, Type, or Execute')
  if (!/^\d+$/.test(fbCampaignId)) throw new Error(`Not a Facebook campaign id: ${fbCampaignId}`)

  if (type === 'Budget Change') {
    const dollars = parseFloat(execute)
    if (!(dollars > 0)) throw new Error(`Invalid budget value: ${execute}`)
    return master.client.post(fbCampaignId, { daily_budget: Math.round(dollars * 100) })
  }
  if (type === 'Status Change') {
    const value = execute.trim().toUpperCase()
    if (value !== 'ACTIVE' && value !== 'PAUSED') throw new Error(`Invalid status value: ${execute}. Must be ACTIVE or PAUSED`)
    return master.client.post(fbCampaignId, { status: value })
  }
  throw new Error(`Unknown action type: ${type}`)
}

export function errorBody(error: unknown) {
  if (error instanceof ApiError) return { error: error.message, ...error.extra }
  return { error: error instanceof Error ? error.message : String(error) }
}
