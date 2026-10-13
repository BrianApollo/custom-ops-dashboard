import { Router, type Request, type Response } from 'express'
import { currentUser } from '../auth/session'
import { settings } from '../env'
import { batch, rows, sql, type Row } from '../lib/d1'
import { today } from '../lib/dates'
import { badRequest, forbidden } from '../lib/errors'
import { RECORD_ID } from '../lib/ids'
import { editorKpi, scriptsPerPeriod, type DoneVideo } from '../lib/overview'
import { isAdmin } from '../permissions'

// The three tabs of the Overview page, each as finished numbers. Only the
// Videos table counts here; AI videos are not part of any of it.
export const overviewRouter = Router()

const DONE = `('Review', 'Available', 'Used')`
// a placeholder user, not a person
const AI_EDITOR = 'AI'

// The upload time and length live inside the `Video Data` JSON text. A value
// that is not valid JSON is treated as having neither.
const UPLOADED_AT = `CASE WHEN json_valid(v.video_data) THEN coalesce(json_extract(v.video_data, '$.lastUploadedAt'), json_extract(v.video_data, '$.firstUploadedAt')) END`
const DURATION = `CASE WHEN json_valid(v.video_data) THEN json_extract(v.video_data, '$.durationSeconds') END`

const doneVideo = (row: Row): DoneVideo => ({
  editorId: row.editor_id as string,
  scriptId: row.script_id as string,
  scriptName: (row.script_name as string | null) ?? '',
  uploadedAt: typeof row.uploaded_at === 'string' && !Number.isNaN(Date.parse(row.uploaded_at)) ? row.uploaded_at : null,
  duration: typeof row.duration === 'number' && row.duration > 0 ? row.duration : null,
})

function timeZone(req: Request) {
  const zone = typeof req.query.tz === 'string' && req.query.tz ? req.query.tz : (settings.TEAM_TIME_ZONE ?? 'Asia/Bangkok')
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: zone })
  } catch {
    throw badRequest(`Unknown time zone ${zone}`, 'tz')
  }
  return zone
}

async function editor(id: unknown) {
  if (id === undefined || id === '') return null
  if (typeof id !== 'string' || !RECORD_ID.test(id)) throw badRequest('editorId must be a record id', 'editorId')
  const [user] = await rows(sql('SELECT id, name FROM users WHERE id = ?', id))
  if (!user) throw badRequest(`Unknown editor ${id}`, 'editorId')
  return user as { id: string; name: string | null }
}

// These numbers need not be live to the second. `fresh=1` skips the cache.
const CACHE_MS = 60_000
const cache = new Map<string, { until: number; body: unknown }>()

async function cached(req: Request, res: Response, work: () => Promise<unknown>) {
  const { fresh: _fresh, ...query } = req.query
  const key = `${req.path}?${JSON.stringify(query)}`
  const hit = cache.get(key)
  if (hit && hit.until > Date.now() && req.query.fresh !== '1') return res.json(hit.body)
  const body = await work()
  if (cache.size > 500) cache.clear()
  cache.set(key, { until: Date.now() + CACHE_MS, body })
  res.set('Cache-Control', 'private, no-cache')
  res.json(body)
}

// GET /overview/products: one row per product, whatever its status
overviewRouter.get('/overview/products', async (req, res) => {
  if (!isAdmin(currentUser(res).role)) throw forbidden()
  await cached(req, res, async () => {
    const hasVideo = 'EXISTS (SELECT 1 FROM videos v WHERE v.script_id = s.id AND v.product_id = p.id)'
    const hasCampaign = 'EXISTS (SELECT 1 FROM campaign_images ci WHERE ci.image_id = i.id)'
    const videos = (status: string) => `(SELECT count(*) FROM videos v WHERE v.product_id = p.id AND v.status = '${status}')`
    const found = await rows(
      sql(
        `SELECT p.id AS productId, p.product_name AS productName,
           (SELECT count(*) FROM video_scripts s WHERE s.product_id = p.id AND ${hasVideo}) AS scriptsAssigned,
           (SELECT count(*) FROM video_scripts s WHERE s.product_id = p.id AND NOT ${hasVideo}) AS scriptsUnassigned,
           ${videos('To Do')} AS videosTodo, ${videos('Review')} AS videosReview,
           ${videos('Available')} AS videosAvailable, ${videos('Used')} AS videosUsed,
           (SELECT count(*) FROM images i WHERE i.product_id = p.id AND NOT ${hasCampaign}) AS imagesAvailable,
           (SELECT count(*) FROM images i WHERE i.product_id = p.id AND ${hasCampaign}) AS imagesUsed
         FROM products p ORDER BY p.product_name COLLATE NOCASE`,
      ),
    )
    const totals: Record<string, number> = {}
    for (const row of found) {
      for (const [name, value] of Object.entries(row)) if (typeof value === 'number') totals[name] = (totals[name] ?? 0) + value
    }
    return { rows: found, totals }
  })
})

// GET /overview/editor-kpi?editorId=&tz=&from=&to=
// Each editor's daily target: 3 scripts a day, 2 on a day with a long script.
overviewRouter.get('/overview/editor-kpi', async (req, res) => {
  const user = currentUser(res)
  // an editor may see their own tracker and nobody else's
  if (!isAdmin(user.role) && !(user.role === 'video_editor' && req.query.editorId === user.id)) throw forbidden()
  const tz = timeZone(req)
  const one = await editor(req.query.editorId)
  const monthKey = (value: unknown, name: string) => {
    if (value === undefined) return undefined
    if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) throw badRequest(`${name} must be a month as YYYY-MM`, name)
    return value
  }
  const from = monthKey(req.query.from, 'from')
  const to = monthKey(req.query.to, 'to')

  await cached(req, res, async () => {
    const [editors, videos] = await batch([
      one
        ? sql('SELECT id, name FROM users WHERE id = ?', one.id)
        : sql(`SELECT id, name FROM users WHERE role = 'Video Editor' AND coalesce(name, '') != ? ORDER BY name COLLATE NOCASE`, AI_EDITOR),
      sql(
        `SELECT v.editor_id, v.script_id, s.name AS script_name, ${UPLOADED_AT} AS uploaded_at, ${DURATION} AS duration
         FROM videos v JOIN video_scripts s ON s.id = v.script_id
         WHERE v.status IN ${DONE} AND v.editor_id IS NOT NULL ${one ? 'AND v.editor_id = ?' : ''}`,
        ...(one ? [one.id] : []),
      ),
    ])
    const byEditor = new Map<string, DoneVideo[]>()
    for (const row of videos.results) byEditor.set(row.editor_id as string, [...(byEditor.get(row.editor_id as string) ?? []), doneVideo(row)])

    return {
      tz,
      currentMonthKey: today(tz).slice(0, 7),
      // an editor with no completed script is left out
      editors: editors.results.flatMap((e) => {
        const kpi = editorKpi(byEditor.get(e.id as string) ?? [], tz)
        if (!kpi) return []
        // the running deficit always starts at the editor's first month, whatever range is shown
        const months = kpi.months.filter((m) => (!from || m.key >= from) && (!to || m.key <= to))
        return [{ editorId: e.id, editorName: e.name, totalScripts: kpi.totalScripts, cumulativeDeficit: kpi.cumulativeDeficit, months }]
      }),
    }
  })
})

// GET /overview/scripts?granularity=monthly|weekly&editorId=&tz=
// The backlog of unfinished work, and completed scripts per month or week.
overviewRouter.get('/overview/scripts', async (req, res) => {
  if (!isAdmin(currentUser(res).role)) throw forbidden()
  const granularity = req.query.granularity ?? 'monthly'
  if (granularity !== 'monthly' && granularity !== 'weekly') throw badRequest('granularity must be monthly or weekly', 'granularity')
  const tz = timeZone(req)
  const one = await editor(req.query.editorId)
  const onlyEditor = one ? 'AND v.editor_id = ?' : ''
  const editorParam = one ? [one.id] : []

  await cached(req, res, async () => {
    const [unfinished, videos, editors] = await batch([
      // one editor's work on one script is an assignment; it is unfinished while any of its videos is not done
      sql(
        `SELECT count(*) AS scripts, count(DISTINCT editor_id) AS editors, coalesce(sum(remaining), 0) AS variantsRemaining
         FROM (
           SELECT v.editor_id, sum(coalesce(v.status, '') NOT IN ${DONE}) AS remaining
           FROM videos v JOIN users u ON u.id = v.editor_id
           WHERE v.script_id IS NOT NULL AND coalesce(u.name, '') != ? ${onlyEditor}
           GROUP BY v.editor_id, v.script_id HAVING remaining > 0
         )`,
        AI_EDITOR,
        ...editorParam,
      ),
      sql(
        `SELECT v.editor_id, v.script_id, '' AS script_name, ${UPLOADED_AT} AS uploaded_at, ${DURATION} AS duration
         FROM videos v WHERE v.status IN ${DONE} AND v.script_id IS NOT NULL ${onlyEditor}`,
        ...editorParam,
      ),
      sql(`SELECT id, name FROM users WHERE role = 'Video Editor' ORDER BY name COLLATE NOCASE`),
    ])
    return {
      tz,
      granularity,
      editorId: one?.id ?? null,
      unfinished: unfinished.results[0],
      rows: scriptsPerPeriod(videos.results.map(doneVideo).filter((v) => v.uploadedAt), granularity, tz, today(tz)),
      editors: editors.results,
    }
  })
})
