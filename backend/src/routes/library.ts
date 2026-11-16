import { Router } from 'express'
import { currentUser } from '../auth/session'
import { countStatement, listStatement, parseListQuery, project } from '../data/read'
import { getTable } from '../data/registry'
import { settings } from '../env'
import { attachment, downloadName, servableKey } from '../lib/assetDownload'
import { batch, IN_LIST, list, rows, sql } from '../lib/d1'
import { ApiError, badRequest, forbidden, notFound } from '../lib/errors'
import { RECORD_ID } from '../lib/ids'
import { publicUrl } from '../lib/storage'
import { parseTagFilter, productCondition, tagConditions } from '../lib/tags'
import { ruleFor } from '../permissions'

export const libraryRouter = Router()

// The Library list: the same parameters as GET /data/media_assets, plus
// `tag[<key>]=<value>` (repeatable; an asset must match every pair) and
// `product=<id>`: that product's own assets and the assets shared to it
// (the shared_products tag, set on footage with no voice).
// A page always needs `limit`; the rows, the total and the check that every
// asked tag type exists come back from one round trip.
//
// GET /library/assets?limit=60&offset=0&fields=…&product=rec…&where[Phase]=solution&tag[shot_type]=close
libraryRouter.get('/library/assets', async (req, res) => {
  const meta = getTable('media_assets')
  const user = currentUser(res)
  if (!ruleFor(user.role, meta.name).read) throw forbidden()

  const { tags, rest } = parseTagFilter(req.query as Record<string, unknown>)
  const { product, ...others } = rest
  if (product !== undefined && (typeof product !== 'string' || !RECORD_ID.test(product))) {
    throw badRequest('product must be a record id', 'product')
  }
  const query = parseListQuery(meta, user, others)
  if (query.limit === null) throw badRequest('limit is required')
  const extra = { sql: [] as string[], params: [] as unknown[] }
  if (product) {
    const own = productCondition(product)
    extra.sql.push(own.sql)
    extra.params.push(...own.params)
  }
  if (tags.length) {
    const tagged = tagConditions(tags)
    extra.sql.push(...tagged.sql)
    extra.params.push(...tagged.params)
  }
  if (extra.sql.length) {
    query.where = `${query.where ? `${query.where} AND ` : ' WHERE '}${extra.sql.join(' AND ')}`
    query.params = [...query.params, ...extra.params]
  }
  const projection = project(meta, query.fields)
  const keys = [...new Set(tags.map((t) => t.key))]
  const [page, count, known] = await batch([
    listStatement(meta, projection, query),
    countStatement(meta, query),
    sql(`SELECT key FROM tag_types WHERE key IN ${IN_LIST}`, list(keys)),
  ])
  const found = new Set(known.results.map((row) => row.key))
  const missing = keys.find((key) => !found.has(key))
  if (missing) throw badRequest(`Unknown tag ${missing}`, `tag[${missing}]`)

  res.set('Cache-Control', 'private, no-cache')
  res.json({
    records: page.results.map(projection.decode),
    total: count.results[0].n,
    limit: query.limit,
    offset: query.offset,
  })
})

// One asset's file as a download (Content-Disposition: attachment), so one
// click saves it. Only a file key under asset-library/ that belongs to a
// media_assets row is served. The file comes from the bucket, or from the
// public files address when the bucket does not hold it (the local copy).
//
// GET /library/assets/:id/download
libraryRouter.get('/library/assets/:id/download', async (req, res) => {
  const user = currentUser(res)
  if (!ruleFor(user.role, 'media_assets').read) throw forbidden()
  const { id } = req.params
  if (!RECORD_ID.test(id)) throw badRequest('id must be a record id', 'id')
  const [asset] = await rows(
    sql(
      `SELECT t.asset_key, t.kind, t.file_key, p.product_name
       FROM media_assets t LEFT JOIN products p ON p.id = t.product_id WHERE t.id = ?`,
      id,
    ),
  )
  if (!asset) throw notFound(`Asset ${id}`)
  const key = asset.file_key
  if (!servableKey(key)) throw notFound(`The file of asset ${id}`)

  let bytes: ArrayBuffer
  let contentType: string | null = null
  const stored = await settings.BUCKET.get(key)
  if (stored) {
    bytes = await stored.arrayBuffer()
    contentType = stored.httpMetadata?.contentType ?? null
  } else {
    const upstream = await fetch(publicUrl(key)).catch(() => null)
    if (!upstream || !upstream.ok) throw new ApiError(502, 'upstream_error', 'The file could not be read')
    bytes = await upstream.arrayBuffer()
    contentType = upstream.headers.get('Content-Type')
  }

  const name = downloadName(asset.product_name as string | null, asset.kind as string | null, String(asset.asset_key ?? id), key)
  res.writeHead(200, {
    'Content-Type': contentType || 'application/octet-stream',
    'Content-Disposition': attachment(name),
    'Content-Length': String(bytes.byteLength),
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(Buffer.from(bytes))
})
