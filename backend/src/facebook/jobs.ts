import { Router } from 'express'
import { currentUser } from '../auth/session'
import { appendLinkStatement } from '../data/write'
import { auditStatement } from '../lib/audit'
import { batch, IN_LIST, list, nowIso, rows, sql } from '../lib/d1'
import { ApiError, invalid, notFound } from '../lib/errors'
import { adAccount, graphId, type FacebookClient } from '../lib/facebook'
import { recordId } from '../lib/ids'
import { keyFromUrl, ownFile, publicUrl } from '../lib/storage'
import { mediaKeyFor } from '../lib/usedMedia'
import { MEDIA } from '../routes/campaigns'
import { withCredential } from './credentials'
import { CREATIVE_FIELDS } from './read'
import { campaignRecordIdFrom, markedUsedOf, markPlan, pickVideoRecord, type MarkPlan, type VideoRecord } from './replaceVideoMark'

// Replacing an ad's video means waiting for Facebook to process the upload,
// which can take ten minutes: longer than a request may run. So the request
// starts the work and returns a job id, and each `GET /jobs/{id}` checks on
// the video and, once it is ready, does the remaining steps.
export const jobsRouter = Router()

const GIVE_UP_MS = 15 * 60 * 1000
const STUCK_MS = 2 * 60 * 1000

interface ReplaceVideo {
  cred: unknown
  adAccountId: string
  adSetId: string
  templateCreativeId: string
  name: string
  utm?: string
  videoId: string
  // the dashboard record behind the file, marked Used once the ad exists; null when none matched
  record?: VideoRecord | null
  // the dashboard campaign to link the video in, when the caller named it
  campaignRecordId?: string
}

interface JobResult {
  adId: string
  creativeId: string
}

// The links a dashboard record may hold for this file: as sent, and as our
// own public link is stored (spaces unescaped)
function storedLinks(videoUrl: unknown) {
  const links = new Set<string>()
  if (typeof videoUrl === 'string') links.add(videoUrl)
  try {
    links.add(publicUrl(keyFromUrl(videoUrl, 'videoUrl')))
  } catch {
    // a link on the fallback address is matched as sent only
  }
  return [...links]
}

async function findVideoRecord(videoUrl: unknown) {
  const links = list(storedLinks(videoUrl))
  const [videos, aiVideos] = await batch([
    sql(`SELECT id FROM videos WHERE creative_link IN ${IN_LIST} ORDER BY id LIMIT 1`, links),
    sql(`SELECT id FROM ai_videos WHERE creative_link IN ${IN_LIST} ORDER BY id LIMIT 1`, links),
  ])
  return pickVideoRecord([
    ...videos.results.map((row) => ({ table: 'videos', id: row.id })),
    ...aiVideos.results.map((row) => ({ table: 'ai_videos', id: row.id })),
  ])
}

// POST /ads/replace-video { cred, adAccountId, adSetId, templateCreativeId, videoUrl, name, utm?, campaignRecordId? }
jobsRouter.post('/ads/replace-video', async (req, res) => {
  const body = req.body ?? {}
  const account = adAccount(String(body.adAccountId ?? ''))
  const adSetId = graphId(body.adSetId, 'adSetId')
  const templateCreativeId = graphId(body.templateCreativeId, 'templateCreativeId')
  if (typeof body.name !== 'string' || !body.name.trim()) throw invalid('name is required', 'name')
  const file = ownFile(body.videoUrl, 'videoUrl')
  const record = await findVideoRecord(body.videoUrl)
  const campaignRecordId = campaignRecordIdFrom(body.campaignRecordId)
  if (campaignRecordId) {
    const [campaign] = await rows(sql('SELECT id FROM campaigns WHERE id = ?', campaignRecordId))
    if (!campaign) throw invalid('campaignRecordId does not exist', 'campaignRecordId')
  }

  const uploaded = await withCredential(body.cred, ({ client }) =>
    client.post(`${account.id}/advideos`, { file_url: file.url, title: body.name }),
  )
  const input: ReplaceVideo = {
    cred: body.cred,
    adAccountId: account.id,
    adSetId,
    templateCreativeId,
    name: body.name,
    utm: typeof body.utm === 'string' && body.utm ? body.utm : undefined,
    videoId: uploaded.id as string,
    record,
    campaignRecordId,
  }
  const jobId = recordId()
  const now = nowIso()
  await sql(
    `INSERT INTO jobs (id, kind, status, input, created_by, created_at, updated_at) VALUES (?, 'replace_video', 'processing', ?, ?, ?, ?)`,
    jobId,
    JSON.stringify(input),
    currentUser(res).id,
    now,
    now,
  ).run()
  res.status(202).json({ jobId })
})

// The steps after the video is ready: its thumbnail, a creative copied from
// the template with the new video in it, and a new paused ad using that creative
async function finish(client: FacebookClient, input: ReplaceVideo) {
  const video = await client.get(input.videoId, { fields: 'thumbnails' })
  const thumbnails = (video.thumbnails?.data ?? []) as { uri: string; is_preferred?: boolean }[]
  const thumbnail = thumbnails.find((t) => t.is_preferred)?.uri ?? thumbnails[0]?.uri
  if (!thumbnail) throw new Error('Could not get video thumbnail')

  const template = await client.get(input.templateCreativeId, { fields: CREATIVE_FIELDS })
  const creative: Record<string, unknown> = { name: input.name }
  if (template.object_story_spec) {
    creative.object_story_spec = {
      page_id: template.object_story_spec.page_id,
      instagram_user_id: template.object_story_spec.instagram_user_id,
      video_data: {
        video_id: input.videoId,
        image_url: thumbnail,
        call_to_action: template.object_story_spec.video_data?.call_to_action,
      },
    }
  }
  if (template.asset_feed_spec) creative.asset_feed_spec = template.asset_feed_spec
  if (template.degrees_of_freedom_spec) {
    creative.degrees_of_freedom_spec = { creative_features_spec: { advantage_plus_creative: { enroll_status: 'OPT_IN' } } }
  }
  const urlTags = input.utm ?? template.url_tags
  if (urlTags) creative.url_tags = urlTags

  const created = await client.post(`${input.adAccountId}/adcreatives`, creative)
  const ad = await client.post(`${input.adAccountId}/ads`, {
    name: input.name,
    adset_id: input.adSetId,
    creative: { creative_id: created.id },
    status: 'PAUSED',
  })
  return { adId: ad.id as string, creativeId: created.id as string }
}

// The dashboard campaign the new ad's video is linked in: the one the caller
// named, or the one recorded for the ad set's Facebook campaign. None found is
// allowed; the video is then marked Used without a link.
async function campaignFor(client: FacebookClient, input: ReplaceVideo) {
  let id = input.campaignRecordId ?? null
  if (!id) {
    try {
      const adSet = await client.get(input.adSetId, { fields: 'campaign_id' })
      const fbCampaignId = typeof adSet.campaign_id === 'string' ? adSet.campaign_id : null
      const [found] = fbCampaignId ? await rows(sql('SELECT id FROM campaigns WHERE fb_campaign_id = ? ORDER BY id LIMIT 1', fbCampaignId)) : []
      id = (found?.id as string | undefined) ?? null
    } catch {
      id = null
    }
  }
  if (!id) return null
  // a link needs both rows to exist still, or the whole transaction would fail
  const [present] = await rows(
    sql(
      `SELECT EXISTS (SELECT 1 FROM campaigns WHERE id = ?) AS campaign, EXISTS (SELECT 1 FROM ${input.record!.table} WHERE id = ?) AS video`,
      id,
      input.record!.id,
    ),
  )
  return present?.campaign && present?.video ? id : null
}

// The one place the end of a replace-video job is written: the job done with
// its result, the audit line, and when a dashboard video is known, that video
// marked Used and linked to the campaign. The video's status is read back into
// the stored result in the same transaction. Returns the result as stored.
async function recordDone(jobId: string, createdBy: string, result: JobResult, plan: MarkPlan | null) {
  const now = nowIso()
  const statements: D1PreparedStatement[] = []
  let save: D1PreparedStatement
  if (plan) {
    statements.push(sql(`UPDATE ${plan.table} SET status = 'Used', updated_at = ? WHERE id = ?`, now, plan.id))
    if (plan.campaignRecordId) {
      const field = MEDIA.find(({ key }) => key === mediaKeyFor(plan.table))!.field
      statements.push(appendLinkStatement(field, plan.campaignRecordId, [plan.id]))
    }
    save = sql(
      `UPDATE jobs SET status = 'done', updated_at = ?,
         result = json_set(?, '$.markedUsed', json_object('table', ?, 'id', ?, 'campaignRecordId', ?, 'status',
           (SELECT status FROM ${plan.table} WHERE id = ?)))
       WHERE id = ?`,
      now,
      JSON.stringify(result),
      plan.table,
      plan.id,
      plan.campaignRecordId,
      plan.id,
      jobId,
    )
  } else {
    save = sql(`UPDATE jobs SET status = 'done', result = ?, updated_at = ? WHERE id = ?`, JSON.stringify({ ...result, markedUsed: null }), now, jobId)
  }
  const results = await batch([
    ...statements,
    save,
    auditStatement(now, createdBy, 'facebook_replace_video', null, result.adId, { creativeId: result.creativeId }),
    sql('SELECT result FROM jobs WHERE id = ?', jobId),
  ])
  return JSON.parse(results[results.length - 1].results[0].result as string) as JobResult
}

// GET /jobs/{id} -> { status: processing | done | failed, adId, creativeId, markedUsed, error }
jobsRouter.get('/jobs/:id', async (req, res) => {
  const { id } = req.params
  const [job] = await rows(sql('SELECT * FROM jobs WHERE id = ?', id))
  if (!job) throw notFound(`Job ${id}`)

  const answer = (status: string, result: { adId?: string; creativeId?: string } = {}, error: string | null = null) =>
    res.json({ status, adId: result.adId ?? null, creativeId: result.creativeId ?? null, markedUsed: markedUsedOf(result), error })
  const fail = async (message: string) => {
    await sql(`UPDATE jobs SET status = 'failed', error = ?, updated_at = ? WHERE id = ?`, message, nowIso(), id).run()
    answer('failed', {}, message)
  }

  if (job.status === 'done') return answer('done', JSON.parse(job.result as string))
  if (job.status === 'failed') return answer('failed', {}, job.error as string)
  if (job.status === 'finishing') {
    // another request is doing the last steps; if it has been silent too long, it died
    if (Date.now() - Date.parse(job.updated_at as string) > STUCK_MS) return fail('The job stopped before it finished')
    return answer('processing')
  }

  const input = JSON.parse(job.input as string) as ReplaceVideo
  try {
    await withCredential(input.cred, async ({ client }) => {
      const video = await client.get(input.videoId, { fields: 'status' })
      const state = video.status?.video_status
      if (state === 'error') return fail('Facebook could not process the video')
      if (state !== 'ready') {
        if (Date.now() - Date.parse(job.created_at as string) > GIVE_UP_MS) return fail('Facebook took too long to process the video')
        return answer('processing')
      }

      // only one request may take the job from here, or the ad would be made twice
      const claimed = await rows(
        sql(`UPDATE jobs SET status = 'finishing', updated_at = ? WHERE id = ? AND status = 'processing' RETURNING id`, nowIso(), id),
      )
      if (!claimed.length) return answer('processing')

      const result = await finish(client, input)
      const plan = input.record ? markPlan(input.record, await campaignFor(client, input)) : null
      answer('done', await recordDone(id, job.created_by as string, result, plan))
    })
  } catch (error) {
    if (res.headersSent) return
    await fail(error instanceof ApiError || error instanceof Error ? error.message : String(error))
  }
})
