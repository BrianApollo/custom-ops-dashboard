import { Router } from 'express'
import { currentUser } from '../auth/session'
import { containsWords, wholeNumber } from '../data/read'
import { batch, sql } from '../lib/d1'
import { badRequest, forbidden, invalid } from '../lib/errors'
import { RECORD_ID } from '../lib/ids'
import { ruleFor } from '../permissions'

export const imagesRouter = Router()

const STATUSES = ['New', 'Available', 'Used']

const SORTS: Record<string, string> = {
  '-createdTime': 'x.created_at DESC, x.name COLLATE NOCASE DESC',
  createdTime: 'x.created_at ASC, x.name COLLATE NOCASE ASC',
  name: 'x.name COLLATE NOCASE ASC',
  '-name': 'x.name COLLATE NOCASE DESC',
}

// The screen shows two tables as one list. An image has no status column:
//   New        a generated image still waiting in temp_images
//   Used       an image linked to at least one campaign
//   Available  an image linked to none
const ALL_IMAGES = `(
  SELECT i.id, 'image' AS source, i.image_name AS name, i.image_drive_link AS url, i.product_id, i.count, i.created_at,
         CASE WHEN EXISTS (SELECT 1 FROM campaign_images ci WHERE ci.image_id = i.id) THEN 'Used' ELSE 'Available' END AS status
  FROM images i
  UNION ALL
  SELECT t.id, 'temp', t.name, t.image_drive_link, t.product_id, NULL, t.created_at, 'New'
  FROM temp_images t
)`

// The Images screen in one request: a page of images with product names, plus
// the totals for the New / Available / Used chips.
//
// GET /images?status=New|Available|Used&productId=rec…&search=text&limit=50&offset=0&sort=-createdTime
imagesRouter.get('/images', async (req, res) => {
  const user = currentUser(res)
  if (!ruleFor(user.role, 'images').read || !ruleFor(user.role, 'temp_images').read) throw forbidden()

  const { status, productId, search, sort = '-createdTime', limit = '50', offset = '0', ...unknown } = req.query
  if (Object.keys(unknown).length) throw badRequest(`Unknown parameter ${Object.keys(unknown)[0]}`)
  if (status !== undefined && !STATUSES.includes(status as string)) {
    throw invalid(`status must be one of: ${STATUSES.join(', ')}`, 'status')
  }
  if (productId !== undefined && (typeof productId !== 'string' || !RECORD_ID.test(productId))) {
    throw invalid('productId must be a record id', 'productId')
  }
  const orderBy = SORTS[String(sort)]
  if (!orderBy) throw invalid(`sort must be one of: ${Object.keys(SORTS).join(', ')}`, 'sort')
  const pageSize = wholeNumber(limit, 'limit', 1)
  const skip = wholeNumber(offset, 'offset', 0)

  // the chips count every image the other filters allow; the chosen status narrows only the rows
  const filters: string[] = []
  const params: unknown[] = []
  if (productId) {
    filters.push('x.product_id = ?')
    params.push(productId)
  }
  if (typeof search === 'string' && search.trim()) {
    const words = containsWords('x.name', search)
    filters.push(words.sql)
    params.push(...words.params)
  }
  const where = (extra: string[] = []) => {
    const all = [...filters, ...extra]
    return all.length ? `WHERE ${all.join(' AND ')}` : ''
  }

  const [page, byStatus] = await batch([
    sql(
      `SELECT x.*, p.product_name FROM ${ALL_IMAGES} x LEFT JOIN products p ON p.id = x.product_id
       ${where(status ? ['x.status = ?'] : [])}
       ORDER BY ${orderBy}, x.id LIMIT ? OFFSET ?`,
      ...params,
      ...(status ? [status] : []),
      pageSize,
      skip,
    ),
    sql(`SELECT x.status, count(*) AS n FROM ${ALL_IMAGES} x ${where()} GROUP BY x.status`, ...params),
  ])

  const counts: Record<string, number> = Object.fromEntries(STATUSES.map((s) => [s, 0]))
  let all = 0
  for (const row of byStatus.results) {
    all += row.n as number
    counts[row.status as string] = row.n as number
  }

  res.set('Cache-Control', 'private, no-cache')
  res.json({
    records: page.results.map((row) => ({
      id: row.id,
      // `temp` rows are approved with POST /temp-images/{id}/approve; `image` rows are in the Images table
      source: row.source,
      name: row.name,
      url: row.url,
      status: row.status,
      productId: row.product_id,
      productName: row.product_name,
      count: row.count,
      createdTime: row.created_at,
    })),
    // rows matching every filter, for the pager
    total: status ? counts[status as string] : all,
    counts: { all, byStatus: counts },
    limit: pageSize,
    offset: skip,
  })
})
