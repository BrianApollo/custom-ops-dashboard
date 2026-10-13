import { Router } from 'express'
import { currentUser } from '../auth/session'
import { CONTAINS, containsParam, wholeNumber } from '../data/read'
import { batch, sql } from '../lib/d1'
import { badRequest, forbidden, invalid } from '../lib/errors'
import { RECORD_ID } from '../lib/ids'
import { ruleFor } from '../permissions'

export const videosRouter = Router()

const STATUSES = ['To Do', 'Review', 'Available', 'Used']

// videos made together share a creation time; the name then puts them in the
// order the screen shows (YouTube, Vertical, Square; No Text first)
const SORTS: Record<string, string> = {
  '-createdTime': 'v.created_at DESC, v.video_name COLLATE NOCASE DESC',
  createdTime: 'v.created_at ASC, v.video_name COLLATE NOCASE ASC',
  name: 'v.video_name COLLATE NOCASE ASC',
  '-name': 'v.video_name COLLATE NOCASE DESC',
}

// The Videos screen in one request: a page of videos with editor and product
// names, plus the totals for the status chips. `kind=ai` is the AI Videos tab.
//
// GET /videos?kind=script|ai&status=Available&productId=rec…&editorId=rec…&search=text&limit=50&offset=0&sort=-createdTime
videosRouter.get('/videos', async (req, res) => {
  const { kind = 'script', status, productId, editorId, search, sort = '-createdTime', limit = '50', offset = '0', ...unknown } = req.query
  if (Object.keys(unknown).length) throw badRequest(`Unknown parameter ${Object.keys(unknown)[0]}`)
  if (kind !== 'script' && kind !== 'ai') throw invalid('kind must be script or ai', 'kind')
  const table = kind === 'ai' ? 'ai_videos' : 'videos'
  if (!ruleFor(currentUser(res).role, table).read) throw forbidden()

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
    filters.push(`v.video_name ${CONTAINS}`)
    params.push(containsParam(search.trim()))
  }
  const where = (extra: string[] = []) => {
    const all = [...filters, ...extra]
    return all.length ? `WHERE ${all.join(' AND ')}` : ''
  }

  // an AI video names its script as plain text and is not linked to one
  const scriptColumns = kind === 'ai' ? 'v.text_version, NULL AS script_id' : 'v.text_version, v.script_id'
  const [page, byStatus] = await batch([
    sql(
      `SELECT v.id, v.video_name, v.format, ${scriptColumns}, v.status, v.creative_link, v.notes, v.created_at,
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
    })),
    // rows matching every filter, for the pager
    total: status ? counts[status as string] : all,
    counts: { all, byStatus: counts },
    limit: pageSize,
    offset: skip,
  })
})
