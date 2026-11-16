import { Router } from 'express'
import { currentUser } from '../auth/session'
import { containsWords, wholeNumber } from '../data/read'
import { batch, rows, sql } from '../lib/d1'
import { badRequest, forbidden, invalid, notFound } from '../lib/errors'
import { RECORD_ID } from '../lib/ids'
import { isAdmin, ruleFor } from '../permissions'
import { resetScore, startCheck } from '../scoring/start'

export const videosRouter = Router()

const STATUSES = ['To Do', 'Review', 'Available', 'Used']

// videos made together share a creation time; the name then puts them in the
// order the screen shows (YouTube, Vertical, Square; No Text first)
const SORTS: Record<string, string> = {
  '-createdTime': 'v.created_at DESC, v.video_name COLLATE NOCASE DESC',
  createdTime: 'v.created_at ASC, v.video_name COLLATE NOCASE ASC',
  name: 'v.video_name COLLATE NOCASE ASC',
  '-name': 'v.video_name COLLATE NOCASE DESC',
  // admins, scripted videos only; unscored videos last
  score: 'v.score IS NULL, v.score ASC, v.created_at DESC',
  '-score': 'v.score IS NULL, v.score DESC, v.created_at DESC',
}
const SCORE_SORTS = new Set(['score', '-score'])

// The Videos screen in one request: a page of videos with editor and product
// names, plus the totals for the status chips. `kind=ai` is the AI Videos tab.
//
// GET /videos?kind=script|ai&status=Available&productId=rec…&editorId=rec…&search=text&limit=50&offset=0&sort=-createdTime
videosRouter.get('/videos', async (req, res) => {
  const { kind = 'script', status, productId, editorId, search, sort = '-createdTime', limit = '50', offset = '0', ...unknown } = req.query
  if (Object.keys(unknown).length) throw badRequest(`Unknown parameter ${Object.keys(unknown)[0]}`)
  if (kind !== 'script' && kind !== 'ai') throw invalid('kind must be script or ai', 'kind')
  const table = kind === 'ai' ? 'ai_videos' : 'videos'
  const { role } = currentUser(res)
  if (!ruleFor(role, table).read) throw forbidden()
  // the automatic check's score, for admins and scripted videos only
  const withScore = kind === 'script' && isAdmin(role)

  if (status !== undefined && !STATUSES.includes(status as string)) {
    throw invalid(`status must be one of: ${STATUSES.join(', ')}`, 'status')
  }
  for (const [name, value] of Object.entries({ productId, editorId })) {
    if (value !== undefined && (typeof value !== 'string' || !RECORD_ID.test(value))) {
      throw invalid(`${name} must be a record id`, name)
    }
  }
  const orderBy = SORTS[String(sort)]
  if (!orderBy) throw invalid(`sort must be one of: ${Object.keys(SORTS).join(', ')}`, 'sort')
  if (SCORE_SORTS.has(String(sort)) && !withScore) throw invalid('Only admins can sort scripted videos by score', 'sort')
  const pageSize = wholeNumber(limit, 'limit', 1)
  const skip = wholeNumber(offset, 'offset', 0)

  // the chips count every video the other filters allow; the chosen status narrows only the rows
  const filters: string[] = []
  const params: unknown[] = []
  if (productId) {
    filters.push('v.product_id = ?')
    params.push(productId)
  }
  if (editorId) {
    filters.push('v.editor_id = ?')
    params.push(editorId)
  }
  if (typeof search === 'string' && search.trim()) {
    const words = containsWords('v.video_name', search)
    filters.push(words.sql)
    params.push(...words.params)
  }
  const where = (extra: string[] = []) => {
    const all = [...filters, ...extra]
    return all.length ? `WHERE ${all.join(' AND ')}` : ''
  }

  // an AI video names its script as plain text and is not linked to one
  const scriptColumns = kind === 'ai' ? 'v.text_version, NULL AS script_id' : 'v.text_version, v.script_id'
  const scoreColumns = withScore ? ', v.score, v.score_status' : ''
  const [page, byStatus] = await batch([
    sql(
      `SELECT v.id, v.video_name, v.format, ${scriptColumns}, v.status, v.creative_link, v.notes, v.created_at${scoreColumns},
              v.editor_id, u.name AS editor_name, v.product_id, p.product_name
       FROM ${table} v
       LEFT JOIN users u ON u.id = v.editor_id
       LEFT JOIN products p ON p.id = v.product_id
       ${where(status ? ['v.status = ?'] : [])}
       ORDER BY ${orderBy}, v.id LIMIT ? OFFSET ?`,
      ...params,
      ...(status ? [status] : []),
      pageSize,
      skip,
    ),
    sql(`SELECT v.status, count(*) AS n FROM ${table} v ${where()} GROUP BY v.status`, ...params),
  ])

  const counts: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]))
  let all = 0
  for (const row of byStatus.results) {
    all += row.n as number
    if (row.status) counts[row.status as string] = row.n as number
  }

  res.set('Cache-Control', 'private, no-cache')
  res.json({
    records: page.results.map((row) => ({
      id: row.id,
      name: row.video_name,
      format: row.format,
      textVersion: row.text_version,
      status: row.status,
      creativeLink: row.creative_link,
      notes: row.notes,
      createdTime: row.created_at,
      editorId: row.editor_id,
      editorName: row.editor_name,
      productId: row.product_id,
      productName: row.product_name,
      scriptId: row.script_id,
      ...(withScore && { score: row.score, scoreStatus: row.score_status }),
    })),
    // rows matching every filter, for the pager
    total: status ? counts[status as string] : all,
    counts: { all, byStatus: counts },
    limit: pageSize,
    offset: skip,
  })
})

// POST /videos/{id}/check -> runs the automatic check again on the video's current file. Admins only.
videosRouter.post('/videos/:id/check', async (req, res) => {
  if (!isAdmin(currentUser(res).role)) throw forbidden()
  const { id } = req.params
  const [video] = await rows(sql('SELECT creative_link, creative_link_updated_at AS at FROM videos WHERE id = ?', id))
  if (!video) throw notFound(`Video ${id}`)
  if (!video.creative_link) throw invalid('The video has no file to check')
  await resetScore(id, true).run()
  await startCheck(id, video.at as string | null)
  res.status(202).json({ success: true })
})
