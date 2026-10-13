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

const AD_ACCOUNT_FIELDS = 'id,name,account_id,account_status,currency,timezone_name,business_name'
export const CAMPAIGN_FIELDS = 'id,name,status,daily_budget,lifetime_budget,objective,created_time,updated_time'
const AD_SET_FIELDS =
  'id,name,campaign_id,status,daily_budget,lifetime_budget,optimization_goal,promoted_object,created_time'
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

readRouter.get('/ad-accounts/:id/pixels', async (req, res) => {
  const { id } = adAccount(req.params.id)
  res.json(
    await withCredential(req.query.cred, async ({ client }) =>
      (await client.list(`${id}/adspixels`, { fields: 'id,name,creation_time,owner_business{id,name}', limit: 100 })).map(
        (p) => ({ id: p.id, name: p.name, creationTime: p.creation_time, ownerBusiness: p.owner_business ?? null }),
      ),
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
