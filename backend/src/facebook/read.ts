import { Router } from 'express'
import { badRequest, invalid } from '../lib/errors'
import { adAccount, graphId, type FacebookClient, type FbObject } from '../lib/facebook'
import { withCredential } from './credentials'

// Reading from Facebook. Objects passed through keep Facebook's own field
// names (daily_budget, effective_status, …) and money stays in cents.
export const readRouter = Router()

const DATE_PRESETS = [
  'today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_28d', 'last_30d', 'last_90d',
  'this_month', 'last_month', 'this_week_mon_today', 'last_week_mon_sun', 'maximum',
]

const AD_ACCOUNT_FIELDS = 'id,name,account_id,account_status,currency,timezone_name,business_name,business{id}'
export const CAMPAIGN_FIELDS =
  'id,name,status,daily_budget,lifetime_budget,spend_cap,bid_strategy,objective,created_time,updated_time'
// the compliance fields let a launcher confirm Facebook kept what it was sent
const AD_SET_FIELDS =
  'id,name,campaign_id,status,daily_budget,lifetime_budget,optimization_goal,promoted_object,created_time,' +
  'start_time,targeting,dsa_beneficiary,dsa_payor,regional_regulated_categories,regional_regulation_identities'
const AD_FIELDS = 'id,name,adset_id,status,creative{id,thumbnail_url,actor_id,object_story_spec{page_id}},created_time'
export const CREATIVE_FIELDS =
  'id,name,object_story_spec,thumbnail_url,instagram_actor_id,asset_feed_spec,degrees_of_freedom_spec,url_tags'
const NEEDS_ATTENTION = ['DISAPPROVED', 'PENDING_REVIEW', 'WITH_ISSUES']

const shapeAccount = (a: FbObject) => ({
  id: a.id as string,
  accountId: a.account_id as string,
  name: a.name,
  accountStatus: a.account_status,
  currency: a.currency,
  timezoneName: a.timezone_name,
  businessName: a.business_name,
  // the business manager that owns the account; null for a personal one
  businessId: (a.business?.id as string | undefined) ?? null,
})

const adAccounts = async (client: FacebookClient) =>
  (await client.list('me/adaccounts', { fields: AD_ACCOUNT_FIELDS, limit: 100 })).map(shapeAccount)

readRouter.get('/ad-accounts', async (req, res) => {
  res.json(
    await withCredential(req.query.cred, async ({ client }) => {
      const [user, accounts] = await Promise.all([client.get('me', { fields: 'id,name' }), adAccounts(client)])
      return {
        user: { id: user.id, name: user.name },
        adAccounts: req.query.activeOnly === '1' ? accounts.filter((a) => a.accountStatus === 1) : accounts,
      }
    }),
  )
})

// Reporting reads on one ad account (insights, campaigns, ad sets, ads) for
// tools that keep their own copy of performance data. One page per call, so a
// large account never holds the request open: send the returned `after` back
// for the next page. Only fields, limit, after, effective_status, filtering
// and, for insights, level, time_increment, time_range, date_preset and
// breakdowns reach Facebook.
const ACCOUNT_EDGES = ['insights', 'campaigns', 'adsets', 'ads']
const LEVELS = ['account', 'campaign', 'adset', 'ad']
const TIME_INCREMENTS = ['1', '7', 'monthly', 'all_days']
const FILTER_OPERATORS = ['EQUAL', 'NOT_EQUAL', 'GREATER_THAN', 'LESS_THAN', 'IN', 'NOT_IN', 'CONTAIN', 'NOT_CONTAIN']
const FIELD_LIST = /^[A-Za-z0-9_.,{}()]+$/
const DAY = /^\d{4}-\d{2}-\d{2}$/

const oneString = (value: unknown, name: string) => {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length > 4000) throw invalid(`${name} must be a single value`, name)
  return value
}

const jsonParam = (value: unknown, name: string) => {
  const text = oneString(value, name)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    throw invalid(`${name} must be JSON`, name)
  }
}

readRouter.get('/ad-accounts/:id/edges/:edge', async (req, res) => {
  const { id } = adAccount(req.params.id)
  const edge = req.params.edge
  if (!ACCOUNT_EDGES.includes(edge)) throw invalid(`edge must be one of: ${ACCOUNT_EDGES.join(', ')}`, 'edge')

  const fields = oneString(req.query.fields, 'fields')
  if (!fields || !FIELD_LIST.test(fields) || /access_token/i.test(fields)) throw invalid('fields must be a Facebook field list', 'fields')
  const params: Record<string, unknown> = { fields }

  const limit = Number(req.query.limit ?? 100)
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw invalid('limit must be 1 to 500', 'limit')
  params.limit = limit

  const after = oneString(req.query.after, 'after')
  if (after !== undefined) {
    if (!/^[A-Za-z0-9_=-]+$/.test(after)) throw invalid('after must be a cursor from a previous page', 'after')
    params.after = after
  }

  const effectiveStatus = jsonParam(req.query.effective_status, 'effective_status')
  if (effectiveStatus !== undefined) {
    if (!Array.isArray(effectiveStatus) || !effectiveStatus.every((s) => typeof s === 'string' && /^[A-Z_]+$/.test(s))) {
      throw invalid('effective_status must be a JSON list of statuses', 'effective_status')
    }
    params.effective_status = effectiveStatus
  }

  const filtering = jsonParam(req.query.filtering, 'filtering')
  if (filtering !== undefined) {
    const scalar = (v: unknown) => typeof v === 'string' || typeof v === 'number'
    const ok =
      Array.isArray(filtering) &&
      filtering.length <= 10 &&
      filtering.every(
        (f) =>
          f &&
          typeof f.field === 'string' &&
          /^[a-z_.]+$/.test(f.field) &&
          FILTER_OPERATORS.includes(f.operator) &&
          (scalar(f.value) || (Array.isArray(f.value) && f.value.length <= 100 && f.value.every(scalar))),
      )
    if (!ok) throw invalid('filtering must be a JSON list of {field, operator, value}', 'filtering')
    params.filtering = filtering.map((f: { field: string; operator: string; value: unknown }) => ({
      field: f.field,
      operator: f.operator,
      value: f.value,
    }))
  }

  if (edge === 'insights') {
    const level = oneString(req.query.level, 'level')
    if (level !== undefined) {
      if (!LEVELS.includes(level)) throw invalid(`level must be one of: ${LEVELS.join(', ')}`, 'level')
      params.level = level
    }
    const increment = oneString(req.query.time_increment, 'time_increment')
    if (increment !== undefined) {
      if (!TIME_INCREMENTS.includes(increment)) throw invalid(`time_increment must be one of: ${TIME_INCREMENTS.join(', ')}`, 'time_increment')
      params.time_increment = increment
    }
    const range = jsonParam(req.query.time_range, 'time_range')
    const preset = oneString(req.query.date_preset, 'date_preset')
    if (range !== undefined) {
      if (!range || !DAY.test(range.since) || !DAY.test(range.until) || range.since > range.until) {
        throw invalid('time_range must be {"since":"YYYY-MM-DD","until":"YYYY-MM-DD"}', 'time_range')
      }
      params.time_range = { since: range.since, until: range.until }
    } else if (preset !== undefined) {
      if (!DATE_PRESETS.includes(preset)) throw invalid(`date_preset must be one of: ${DATE_PRESETS.join(', ')}`, 'date_preset')
      params.date_preset = preset
    }
    const breakdowns = oneString(req.query.breakdowns, 'breakdowns')
    if (breakdowns !== undefined) {
      if (!/^[a-z_,]+$/.test(breakdowns)) throw invalid('breakdowns must be a list of breakdown names', 'breakdowns')
      params.breakdowns = breakdowns
    }
  }

  res.json(
    await withCredential(req.query.cred, async ({ client }) => {
      const body = await client.get(`${id}/${edge}`, params)
      return {
        data: (body.data as FbObject[] | undefined) ?? [],
        after: body.paging?.next ? ((body.paging.cursors?.after as string | undefined) ?? null) : null,
      }
    }),
  )
})

readRouter.get('/ad-accounts/:id/pixels', async (req, res) => {
  const { id } = adAccount(req.params.id)
  res.json(
    await withCredential(req.query.cred, async ({ client }) =>
      (
        await client.list(`${id}/adspixels`, {
          fields: 'id,name,creation_time,last_fired_time,owner_business{id,name}',
          limit: 100,
        })
      ).map((p) => ({
        id: p.id,
        name: p.name,
        creationTime: p.creation_time,
        // absent when the pixel has never fired
        lastFiredTime: p.last_fired_time ?? null,
        ownerBusiness: p.owner_business ?? null,
      })),
    ),
  )
})

// the page access_token is never asked for, so it cannot leak
readRouter.get('/pages', async (req, res) => {
  res.json(
    await withCredential(req.query.cred, async ({ client }) =>
      (await client.list('me/accounts', { fields: 'id,name,category', limit: 100 })).map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
      })),
    ),
  )
})

// Names of pages, pixels and the like. Facebook fails a whole group when the
// token cannot read one id in it, so a failed group is retried one id at a
// time and the unreadable ones are left out.
readRouter.get('/names', async (req, res) => {
  const ids = [...new Set(String(req.query.ids ?? '').split(',').filter(Boolean))].map((id) => graphId(id, 'ids'))
  if (ids.length === 0 || ids.length > 500) throw badRequest('ids must hold 1 to 500 ids')
  res.json(
    await withCredential(req.query.cred, async ({ client }) => {
      const names: Record<string, string> = {}
      const read = async (group: string[]) => {
        const found = await client.get('', { ids: group.join(','), fields: 'name' })
        for (const [id, object] of Object.entries(found)) if (object?.name) names[id] = object.name
      }
      const groups = Array.from({ length: Math.ceil(ids.length / 50) }, (_, i) => ids.slice(i * 50, i * 50 + 50))
      await Promise.all(
        groups.map((group) =>
          read(group).catch(() => Promise.all(group.map((id) => read([id]).catch(() => undefined)))),
        ),
      )
      return names
    }),
  )
})

// The Manage page asks for this repeatedly and it costs one call chain per ad account
const CACHE_MS = 60_000
const campaignCache = new Map<string, { until: number; body: unknown }>()

// a change made through this API must show up on the next read
export const forgetCampaigns = () => campaignCache.clear()

readRouter.get('/campaigns', async (req, res) => {
  const preset = String(req.query.datePreset ?? 'last_7d')
  if (!DATE_PRESETS.includes(preset)) throw invalid(`datePreset must be one of: ${DATE_PRESETS.join(', ')}`, 'datePreset')

  res.json(
    await withCredential(req.query.cred, async ({ kind, recordId, client }) => {
      const key = `${kind}:${recordId}:${preset}`
      const hit = campaignCache.get(key)
      // the Refresh button sends refresh=1
      if (hit && hit.until > Date.now() && req.query.refresh !== '1') return hit.body

      const accounts = (await adAccounts(client)).filter((a) => a.accountStatus === 1)
      const failedAdAccounts: string[] = []
      const fields = `${CAMPAIGN_FIELDS},insights.date_preset(${preset}){spend,purchase_roas,actions,action_values}`
      const perAccount = await Promise.all(
        accounts.map(async (account) => {
          try {
            const campaigns = await client.list(`${account.id}/campaigns`, { fields, limit: 100 })
            return campaigns.map((c) => ({ ...c, adAccountId: account.id, adAccountName: account.name }))
          } catch {
            // one unreadable account does not hide the others
            failedAdAccounts.push(account.id)
            return []
          }
        }),
      )
      const body = { adAccounts: accounts, campaigns: perAccount.flat(), failedAdAccounts }
      if (campaignCache.size > 200) campaignCache.clear()
      campaignCache.set(key, { until: Date.now() + CACHE_MS, body })
      return body
    }),
  )
})

readRouter.get('/campaigns/:id', async (req, res) => {
  const id = graphId(req.params.id, 'campaignId')
  res.json(
    await withCredential(req.query.cred, async ({ client }) => {
      const [campaign, adSets, ads] = await Promise.all([
        client.get(id, { fields: CAMPAIGN_FIELDS }),
        client.list(`${id}/adsets`, { fields: AD_SET_FIELDS, limit: 100 }),
        client.list(`${id}/ads`, { fields: AD_FIELDS, limit: 100 }),
      ])
      return { campaign, adSets, ads }
    }),
  )
})

readRouter.get('/creatives/:id', async (req, res) => {
  const id = graphId(req.params.id, 'creativeId')
  res.json(await withCredential(req.query.cred, ({ client }) => client.get(id, { fields: CREATIVE_FIELDS })))
})

// Ads that are disapproved, in review or have issues, for the given campaigns.
// Campaigns with none are left out.
readRouter.post('/campaigns/ad-review', async (req, res) => {
  const campaigns = req.body?.campaigns
  if (!Array.isArray(campaigns) || campaigns.length > 500) throw badRequest('campaigns must be a list of up to 500')
  for (const campaign of campaigns) graphId(campaign?.id, 'campaigns.id')

  res.json(
    await withCredential(req.body?.cred, async ({ client }) => {
      const checked = await Promise.all(
        campaigns.map(async (campaign: { id: string; name?: string; adAccountId?: string }) => {
          const ads = await client
            .list(`${campaign.id}/ads`, { fields: 'id,name,effective_status,ad_review_feedback', limit: 500 })
            .catch(() => [])
          return {
            campaignId: campaign.id,
            campaignName: campaign.name ?? null,
            adAccountId: campaign.adAccountId ?? null,
            ads: ads.filter((ad) => NEEDS_ATTENTION.includes(ad.effective_status)),
          }
        }),
      )
      return checked.filter((campaign) => campaign.ads.length)
    }),
  )
})
