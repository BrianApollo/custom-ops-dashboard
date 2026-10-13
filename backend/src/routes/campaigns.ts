import type { FieldMapping } from '@ops/shared'
import { Router, type Response } from 'express'
import { currentUser } from '../auth/session'
import { project, readableFields, selectByIds } from '../data/read'
import { getTable } from '../data/registry'
import { appendLinkStatement } from '../data/write'
import { batch, IN_LIST, list, nowIso, rows, sql } from '../lib/d1'
import { badRequest, forbidden, invalid, notFound } from '../lib/errors'
import { RECORD_ID } from '../lib/ids'
import { ruleFor } from '../permissions'

export const campaignsRouter = Router()

const campaigns = getTable('campaigns')

type Junction = Extract<FieldMapping, { kind: 'junction' }>

// request key -> the campaign link field it adds to
const MEDIA = [
  { key: 'videoIds', field: campaigns.fields.get('Videos Used In This Campaign') as Junction },
  { key: 'aiVideoIds', field: campaigns.fields.get('Videos copy') as Junction },
  { key: 'imageIds', field: campaigns.fields.get('Images Used In This Campaign') as Junction },
]

function mediaFrom(body: Record<string, unknown>) {
  return MEDIA.flatMap(({ key, field }) => {
    const ids = body?.[key]
    if (ids === undefined) return []
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !RECORD_ID.test(id))) {
      throw invalid(`${key} must be a list of record ids`, key)
    }
    return ids.length ? [{ key, field, ids: [...new Set(ids as string[])] }] : []
  })
}

function requireUpdate(res: Response) {
  if (ruleFor(currentUser(res).role, 'campaigns').update !== true) throw forbidden()
}

// One read confirms the campaign exists and every id is in the table its list
// is for, so a video id sent as an image is refused instead of half-applied
async function check(id: string, media: ReturnType<typeof mediaFrom>) {
  const results = await batch([
    sql('SELECT id FROM campaigns WHERE id = ?', id),
    ...media.map(({ field, ids }) => sql(`SELECT count(*) AS n FROM ${field.target} WHERE id IN ${IN_LIST}`, list(ids))),
  ])
  if (!results[0].results.length) throw notFound(`Campaign ${id}`)
  media.forEach(({ key, ids }, i) => {
    if (results[i + 1].results[0].n !== ids.length) throw invalid(`${key} contains an id that does not exist`, key)
  })
}

async function respond(res: Response, id: string, statements: D1PreparedStatement[]) {
  const projection = project(campaigns, readableFields(campaigns, currentUser(res), true))
  const results = await batch([...statements, selectByIds(campaigns, projection, [id])])
  res.json(projection.decode(results[results.length - 1].results[0]))
}

// Adds videos, AI videos and images to a campaign. Existing links stay and duplicates are ignored.
campaignsRouter.post('/:id/media', async (req, res) => {
  requireUpdate(res)
  const { id } = req.params
  const media = mediaFrom(req.body)
  await check(id, media)
  await respond(res, id, [
    ...media.map(({ field, ids }) => appendLinkStatement(field, id, ids)),
    sql('UPDATE campaigns SET updated_at = ? WHERE id = ?', nowIso(), id),
  ])
})

// Records a finished launch in one transaction: Facebook ids, snapshot, status,
// the media that went out, and those videos marked Used
campaignsRouter.post('/:id/launch-result', async (req, res) => {
  requireUpdate(res)
  const { id } = req.params
  const body = req.body ?? {}
  if (typeof body.fbCampaignId !== 'string' || !body.fbCampaignId) {
    throw invalid('fbCampaignId is required', 'fbCampaignId')
  }
  const snapshot =
    body.launchedData == null || typeof body.launchedData === 'string' ? body.launchedData : JSON.stringify(body.launchedData)
  const media = mediaFrom(body)
  await check(id, media)

  const now = nowIso()
  const used = media.filter(({ key }) => key !== 'imageIds')
  await respond(res, id, [
    sql(
      `UPDATE campaigns SET fb_campaign_id = ?, fb_ad_account_id = ?, launch_profile_id = ?, launched_data = ?,
         status = 'Launched', launched_at = ?, updated_at = ? WHERE id = ?`,
      body.fbCampaignId,
      body.fbAdAccountId ?? null,
      body.launchProfileId ?? null,
      snapshot ?? null,
      now,
      now,
      id,
    ),
    ...media.map(({ field, ids }) => appendLinkStatement(field, id, ids)),
    ...used.map(({ field, ids }) =>
      sql(`UPDATE ${field.target} SET status = 'Used', updated_at = ? WHERE id IN ${IN_LIST}`, now, list(ids)),
    ),
  ])
})

// Looks campaigns up by Facebook campaign id. GET ?ids=a,b or POST { ids } for long lists.
campaignsRouter.all('/by-fb-id', async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'POST') throw badRequest('Use GET or POST')
  if (!ruleFor(currentUser(res).role, 'campaigns').read) throw forbidden()
  const ids = req.method === 'GET' ? String(req.query.ids ?? '').split(',').filter(Boolean) : req.body?.ids
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw badRequest('ids must be a list')

  const found = await rows(
    sql(
      `SELECT id, fb_campaign_id AS fbCampaignId, name, product_id AS productId, redtrack_campaign_id AS redtrackCampaignId, status
       FROM campaigns WHERE fb_campaign_id IN ${IN_LIST}`,
      list(ids),
    ),
  )
  res.json({ campaigns: found })
})
