import { Router } from 'express'
import { currentUser } from '../auth/session'
import { containsWords, wholeNumber } from '../data/read'
import { batch, sql } from '../lib/d1'
import { badRequest, forbidden, invalid } from '../lib/errors'
import { RECORD_ID } from '../lib/ids'
import { ruleFor } from '../permissions'

export const scriptsRouter = Router()

const SORTS: Record<string, string> = {
  name: 's.name COLLATE NOCASE ASC',
  '-name': 's.name COLLATE NOCASE DESC',
  createdTime: 's.created_at ASC',
  '-createdTime': 's.created_at DESC',
}

const HAS_VIDEOS = 'EXISTS (SELECT 1 FROM videos v WHERE v.script_id = s.id)'

// The Scripts screen in one request: a page of scripts, each with its product
// name, who it is assigned to, how far along it is and its videos for the
// expanded row, plus the totals for the Assigned / Unassigned chips.
//
// GET /scripts?limit=50&offset=0&productId=rec…&assigned=true|false&search=text&sort=-createdTime
scriptsRouter.get('/scripts', async (req, res) => {
  const user = currentUser(res)
  if (!ruleFor(user.role, 'video_scripts').read || !ruleFor(user.role, 'videos').read) throw forbidden()

  const { productId, assigned, search, sort = '-createdTime', limit = '50', offset = '0', ...unknown } = req.query
  if (Object.keys(unknown).length) throw badRequest(`Unknown parameter ${Object.keys(unknown)[0]}`)
  if (productId !== undefined && (typeof productId !== 'string' || !RECORD_ID.test(productId))) {
    throw invalid('productId must be a record id', 'productId')
  }
  if (assigned !== undefined && assigned !== 'true' && assigned !== 'false') {
    throw invalid('assigned must be true or false', 'assigned')
  }
  const orderBy = SORTS[String(sort)]
  if (!orderBy) throw invalid(`sort must be one of: ${Object.keys(SORTS).join(', ')}`, 'sort')
  const pageSize = wholeNumber(limit, 'limit', 1)
  const skip = wholeNumber(offset, 'offset', 0)

  // the chips count every script the product and search filters allow; the
  // Assigned / Unassigned choice narrows only the rows
  const filters: string[] = []
  const params: unknown[] = []
  if (productId) {
    filters.push('s.product_id = ?')
    params.push(productId)
  }
  if (typeof search === 'string' && search.trim()) {
    const words = containsWords('s.name', search)
    filters.push(words.sql)
    params.push(...words.params)
  }
  const base = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
  const chosen = assigned === undefined ? filters : [...filters, assigned === 'true' ? HAS_VIDEOS : `NOT ${HAS_VIDEOS}`]
  const where = chosen.length ? `WHERE ${chosen.join(' AND ')}` : ''

  const [page, totals, scored] = await batch([
    sql(
      `SELECT s.id, s.name, s.product_id, p.product_name, s.author_id, s.created_at, s.hook_family,
         sc.status AS score_status, sc.rank_score, sc.spend AS score_spend, sc.purchases AS score_purchases,
         (SELECT count(*) FROM videos v WHERE v.script_id = s.id) AS video_count,
         (SELECT count(*) FROM videos v WHERE v.script_id = s.id AND v.status != 'To Do') AS past_to_do,
         (SELECT json_group_array(json_object('id', e.editor_id, 'name', e.name, 'videos', e.n))
            FROM (SELECT v.editor_id, u.name, count(*) AS n
                  FROM videos v LEFT JOIN users u ON u.id = v.editor_id
                  WHERE v.script_id = s.id GROUP BY v.editor_id ORDER BY u.name) e) AS editors,
         (SELECT json_group_array(json_object('id', x.id, 'name', x.video_name, 'format', x.format,
                   'textVersion', x.text_version, 'status', x.status, 'editorId', x.editor_id,
                   'creativeLink', x.creative_link))
            FROM (SELECT * FROM videos v WHERE v.script_id = s.id ORDER BY v.video_name DESC) x) AS videos
       FROM video_scripts s LEFT JOIN products p ON p.id = s.product_id
       LEFT JOIN script_scores sc ON sc.video_script_id = s.id
       ${where} ORDER BY ${orderBy}, s.id LIMIT ? OFFSET ?`,
      ...params,
      pageSize,
      skip,
    ),
    sql(`SELECT count(*) AS total, coalesce(sum(${HAS_VIDEOS}), 0) AS assigned FROM video_scripts s ${base}`, ...params),
    sql('SELECT max(computed_at) AS computed_at FROM script_scores'),
  ])

  const all = totals.results[0].total as number
  const withVideos = totals.results[0].assigned as number
  const counts = { all, assigned: withVideos, unassigned: all - withVideos }

  res.set('Cache-Control', 'private, no-cache')
  res.json({
    records: page.results.map((row) => {
      const videoCount = row.video_count as number
      return {
        id: row.id,
        name: row.name,
        productId: row.product_id,
        productName: row.product_name,
        authorId: row.author_id,
        createdTime: row.created_at,
        assigned: videoCount > 0,
        videoCount,
        // share of the script's videos that are past To Do, 0 to 1; null when it has none
        progress: videoCount ? (row.past_to_do as number) / videoCount : null,
        editors: JSON.parse(row.editors as string),
        videos: JSON.parse(row.videos as string),
        hookFamily: row.hook_family,
        // from our own tracking; null when the script has no score yet
        score:
          row.score_status === null
            ? null
            : { status: row.score_status, rankScore: row.rank_score, spend: row.score_spend, purchases: row.score_purchases },
      }
    }),
    // rows matching every filter, for the pager
    total: assigned === undefined ? counts.all : assigned === 'true' ? counts.assigned : counts.unassigned,
    counts,
    // when the newest score was computed; null when there are no scores
    scoresComputedAt: (scored.results[0]?.computed_at as string | null) ?? null,
    limit: pageSize,
    offset: skip,
  })
})
