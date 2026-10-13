import { Router, type Response } from 'express'
import { currentUser } from '../auth/session'
import { auditStatement } from '../lib/audit'
import { batch, IN_LIST, list, nowIso, rows, sql } from '../lib/d1'
import { badRequest, conflict, forbidden, invalid, notFound } from '../lib/errors'
import { recordId, RECORD_ID } from '../lib/ids'
import { ruleFor } from '../permissions'
import { countStatement, inOrder, listStatement, parseListQuery, project, readableFields, selectByIds } from './read'
import { getTable, type TableMeta } from './registry'
import { createStatements, planWrite, updateStatements } from './write'

export const dataRouter = Router()

const MAX_BATCH = 200
const DAY_MS = 24 * 60 * 60 * 1000

// Writes to these are recorded in the audit log, and their responses are never cached
const SENSITIVE = new Set(['profiles', 'business_managers', 'ad_accounts', 'pages', 'pixels', 'users'])

function cacheable(res: Response, meta: TableMeta) {
  // the browser keeps the response but must revalidate it; an unchanged list costs a 304 with no body
  res.set('Cache-Control', SENSITIVE.has(meta.name) ? 'no-store' : 'private, no-cache')
}

function recordsFrom(body: unknown, needsId: boolean) {
  const records = (body as { records?: unknown })?.records
  if (!Array.isArray(records) || records.length === 0) throw badRequest('records must be a non-empty list')
  if (records.length > MAX_BATCH) throw badRequest(`At most ${MAX_BATCH} records per request`)
  if (needsId && records.some((r) => typeof r?.id !== 'string')) throw badRequest('Every record needs an id')
  return records as { id: string; fields: unknown }[]
}

dataRouter.get('/:table', async (req, res) => {
  const meta = getTable(req.params.table)
  const user = currentUser(res)
  if (!ruleFor(user.role, meta.name).read) throw forbidden()

  const query = parseListQuery(meta, user, req.query)
  const projection = project(meta, query.fields)
  cacheable(res, meta)
  if (query.limit === null) {
    const found = await rows(listStatement(meta, projection, query))
    res.json({ records: found.map(projection.decode) })
    return
  }
  // a page: the rows and the total come back from one round trip
  const [page, count] = await batch([listStatement(meta, projection, query), countStatement(meta, query)])
  res.json({
    records: page.results.map(projection.decode),
    total: count.results[0].n,
    limit: query.limit,
    offset: query.offset,
  })
})

dataRouter.get('/:table/:id', async (req, res) => {
  const meta = getTable(req.params.table)
  const user = currentUser(res)
  if (!ruleFor(user.role, meta.name).read) throw forbidden()

  const projection = project(meta, readableFields(meta, user, true))
  const [row] = await rows(selectByIds(meta, projection, [req.params.id]))
  if (!row) throw notFound(`${meta.label} ${req.params.id}`)
  cacheable(res, meta)
  res.json(projection.decode(row))
})

dataRouter.post('/:table', async (req, res) => {
  const meta = getTable(req.params.table)
  const user = currentUser(res)
  if (!ruleFor(user.role, meta.name).create) throw forbidden()

  const many = Array.isArray(req.body?.records)
  const inputs = many ? recordsFrom(req.body, false).map((r) => r.fields) : [req.body?.fields]
  const now = nowIso()
  const ids = inputs.map(() => recordId())
  const projection = project(meta, readableFields(meta, user, true))
  const respond = (found: Awaited<ReturnType<typeof rows>>) => {
    const records = inOrder(found.map(projection.decode), ids)
    res.json(many ? { records } : records[0])
  }

  const statements = inputs.flatMap((fields, i) => createStatements(meta, ids[i], planWrite(meta, fields, user), now))
  if (SENSITIVE.has(meta.name)) statements.push(auditStatement(now, user.id, 'create', meta.name, null, ids))

  // With an Idempotency-Key, the key is stored in the same transaction as the
  // records. A repeat fails on the key and gets the first request's records.
  const key = req.get('Idempotency-Key')
  if (key) {
    statements.unshift(
      sql('DELETE FROM idempotency_keys WHERE created_at < ?', new Date(Date.now() - DAY_MS).toISOString()),
      sql(
        'INSERT INTO idempotency_keys (key, user_id, table_name, record_ids, created_at) VALUES (?, ?, ?, ?, ?)',
        key,
        user.id,
        meta.name,
        list(ids),
        now,
      ),
    )
  }
  statements.push(selectByIds(meta, projection, ids))

  try {
    const results = await batch(statements)
    respond(results[results.length - 1].results)
  } catch (error) {
    if (!key || !/idempotency_keys/.test(String((error as Error).message))) throw error
    const [first] = await rows(sql('SELECT user_id, table_name, record_ids FROM idempotency_keys WHERE key = ?', key))
    if (!first || first.user_id !== user.id || first.table_name !== meta.name) {
      throw conflict('Idempotency-Key was already used for a different request')
    }
    ids.splice(0, ids.length, ...(JSON.parse(first.record_ids as string) as string[]))
    respond(await rows(selectByIds(meta, projection, ids)))
  }
})

async function update(res: Response, meta: TableMeta, items: { id: string; fields: unknown }[]) {
  const user = currentUser(res)
  const rule = ruleFor(user.role, meta.name).update
  if (!rule) throw forbidden()
  const own = rule === true ? undefined : rule

  const ids = items.map((item) => item.id)
  const existing = await rows(
    sql(`SELECT id${own ? `, ${own.ownColumn} AS owner` : ''} FROM ${meta.name} WHERE id IN ${IN_LIST}`, list(ids)),
  )
  const found = new Map(existing.map((row) => [row.id, row]))
  for (const id of ids) {
    const row = found.get(id)
    if (!row) throw notFound(`${meta.label} ${id}`)
    if (own && row.owner !== user.id) throw forbidden('You can only change records assigned to you')
  }

  const now = nowIso()
  const projection = project(meta, readableFields(meta, user, true))
  const statements = items.flatMap((item) =>
    updateStatements(meta, item.id, planWrite(meta, item.fields, user, own), now),
  )
  if (SENSITIVE.has(meta.name)) statements.push(auditStatement(now, user.id, 'update', meta.name, null, ids))
  statements.push(selectByIds(meta, projection, ids))

  const results = await batch(statements)
  return inOrder(results[results.length - 1].results.map(projection.decode), ids)
}

dataRouter.patch('/:table/:id', async (req, res) => {
  const meta = getTable(req.params.table)
  const [record] = await update(res, meta, [{ id: req.params.id, fields: req.body?.fields }])
  res.json(record)
})

dataRouter.patch('/:table', async (req, res) => {
  const meta = getTable(req.params.table)
  res.json({ records: await update(res, meta, recordsFrom(req.body, true)) })
})

async function remove(res: Response, meta: TableMeta, ids: string[]) {
  const user = currentUser(res)
  if (!ruleFor(user.role, meta.name).delete) throw forbidden()
  if (ids.some((id) => !RECORD_ID.test(id))) throw invalid('ids must be record ids')

  const [deleted] = await batch([
    sql(`DELETE FROM ${meta.name} WHERE id IN ${IN_LIST} RETURNING id`, list(ids)),
    sql(`DELETE FROM attachments WHERE table_name = ? AND record_id IN ${IN_LIST}`, meta.name, list(ids)),
    auditStatement(nowIso(), user.id, 'delete', meta.name, null, ids),
  ])
  return deleted.results.map((row) => ({ id: row.id as string, deleted: true }))
}

dataRouter.delete('/:table/:id', async (req, res) => {
  const meta = getTable(req.params.table)
  const [deleted] = await remove(res, meta, [req.params.id])
  if (!deleted) throw notFound(`${meta.label} ${req.params.id}`)
  res.json(deleted)
})

dataRouter.delete('/:table', async (req, res) => {
  const meta = getTable(req.params.table)
  const ids = req.body?.ids
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BATCH) {
    throw badRequest(`ids must be a list of 1 to ${MAX_BATCH} record ids`)
  }
  res.json({ records: await remove(res, meta, ids) })
})
