import { Router, type Response } from 'express'
import { currentUser } from '../auth/session'
import { auditStatement } from '../lib/audit'
import { nowIso } from '../lib/d1'
import { badRequest, invalid } from '../lib/errors'
import { graphId } from '../lib/facebook'
import { withCredential } from './credentials'
import { forgetCampaigns } from './read'

// Changes to live campaigns, ad sets and ads. Each one is written to the audit log.
export const writeRouter = Router()

const STATUSES = ['ACTIVE', 'PAUSED']

function status(value: unknown) {
  if (!STATUSES.includes(value as string)) throw invalid('status must be ACTIVE or PAUSED', 'status')
  return value as string
}

const record = (res: Response, action: string, id: string, detail: unknown) =>
  auditStatement(nowIso(), currentUser(res).id, action, null, id, detail).run()

// PATCH /campaigns/{id} { cred, status?, dailyBudgetCents? }
writeRouter.patch('/campaigns/:id', async (req, res) => {
  const id = graphId(req.params.id, 'campaignId')
  const body = req.body ?? {}
  const change: Record<string, unknown> = {}
  if (body.status !== undefined) change.status = status(body.status)
  if (body.dailyBudgetCents !== undefined) {
    if (!Number.isInteger(body.dailyBudgetCents) || body.dailyBudgetCents <= 0) {
      throw invalid('dailyBudgetCents must be a positive whole number of cents', 'dailyBudgetCents')
    }
    change.daily_budget = body.dailyBudgetCents
  }
  if (!Object.keys(change).length) throw badRequest('Give status, dailyBudgetCents or both')

  await withCredential(body.cred, ({ client }) => client.post(id, change))
  forgetCampaigns()
  await record(res, 'facebook_campaign_update', id, change)
  res.json({ id, success: true })
})

for (const [path, action] of [
  ['/adsets/:id', 'facebook_adset_update'],
  ['/ads/:id', 'facebook_ad_update'],
] as const) {
  // PATCH /adsets/{id} and /ads/{id} { cred, status }
  writeRouter.patch(path, async (req, res) => {
    const id = graphId(req.params.id, 'id')
    const change = { status: status(req.body?.status) }
    await withCredential(req.body?.cred, ({ client }) => client.post(id, change))
    await record(res, action, id, change)
    res.json({ id, success: true })
  })
}

// Facebook has no delete call for an ad; it is given the status DELETED
writeRouter.delete('/ads/:id', async (req, res) => {
  const id = graphId(req.params.id, 'id')
  await withCredential(req.query.cred, ({ client }) => client.post(id, { status: 'DELETED' }))
  await record(res, 'facebook_ad_delete', id, null)
  res.json({ id, success: true })
})

// POST /ads/request-review { cred, ads: [{ id, name }] }
// Asks Facebook to review each ad again. One ad failing does not stop the rest.
writeRouter.post('/ads/request-review', async (req, res) => {
  const ads = req.body?.ads
  if (!Array.isArray(ads) || ads.length === 0 || ads.length > 200) throw badRequest('ads must be a list of 1 to 200')
  for (const ad of ads) graphId(ad?.id, 'ads.id')

  const results = await withCredential(req.body?.cred, async ({ client }) => {
    const out: { adId: string; adName: string | null; success: boolean; error: string | null }[] = []
    // three at a time, as the dashboard has always done
    for (let i = 0; i < ads.length; i += 3) {
      out.push(
        ...(await Promise.all(
          ads.slice(i, i + 3).map(async (ad: { id: string; name?: string }) => {
            try {
              await client.post(ad.id, { review_request: 'true' })
              return { adId: ad.id, adName: ad.name ?? null, success: true, error: null }
            } catch (error) {
              return { adId: ad.id, adName: ad.name ?? null, success: false, error: (error as Error).message }
            }
          }),
        )),
      )
    }
    return out
  })
  await record(res, 'facebook_request_review', '', { ads: results.filter((r) => r.success).map((r) => r.adId) })
  res.json(results)
})
