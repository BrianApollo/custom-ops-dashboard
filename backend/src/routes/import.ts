import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core'
import { Router } from 'express'
import { currentUser } from '../auth/session'
import * as schema from '../db/schema'
import { settings } from '../env'
import { batch, list, rows, sql } from '../lib/d1'
import { badRequest, forbidden, notFound } from '../lib/errors'

// Bulk loading for the Airtable import script. Only the service token may call
// these, and only while IMPORT_ENABLED is true. Rows arrive already shaped as
// column values; each request is one statement or one atomic batch.
export const importRouter = Router()

interface TableInfo {
  columns: Set<string>
  primaryKey: string[]
}

// every table in the Drizzle schema, so column names in a request can be checked
const TABLES = new Map<string, TableInfo>()
for (const value of Object.values(schema)) {
  if (!(value instanceof SQLiteTable)) continue
  const config = getTableConfig(value)
  const composite = config.primaryKeys[0]?.columns.map((c) => c.name)
  TABLES.set(config.name, {
    columns: new Set(config.columns.map((c) => c.name)),
    primaryKey: composite ?? config.columns.filter((c) => c.primary).map((c) => c.name),
  })
}

// rows of one statement travel as a single JSON parameter; this keeps each well under D1's 2 MB value limit
const ROWS_PER_STATEMENT = 2000

importRouter.use((_req, res, next) => {
  if (settings.IMPORT_ENABLED !== 'true') throw notFound('Import routes are switched off; this route')
  if (currentUser(res).role !== 'service') throw forbidden()
  next()
})

function payload(body: Record<string, unknown>) {
  const name = body?.table
  const table = typeof name === 'string' ? TABLES.get(name) : undefined
  if (!table) throw badRequest(`Unknown table ${String(name)}`)
  const columns = body.columns
  if (!Array.isArray(columns) || columns.length === 0 || columns.some((c) => !table.columns.has(c))) {
    throw badRequest(`columns must be column names of ${name}`)
  }
  const data = body.rows
  if (!Array.isArray(data) || data.some((row) => !Array.isArray(row) || row.length !== columns.length)) {
    throw badRequest('rows must be a list of value lists, one value per column')
  }
  if (table.primaryKey.some((key) => !columns.includes(key))) {
    throw badRequest(`columns must include the primary key: ${table.primaryKey.join(', ')}`)
  }
  return { name: name as string, table, columns: columns as string[], data: data as unknown[][] }
}

const fromJson = (columns: string[], alias = 'value') =>
  columns.map((_, i) => `json_extract(${alias}, '$[${i}]')`).join(', ')

function chunks<T>(items: T[]) {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += ROWS_PER_STATEMENT) out.push(items.slice(i, i + ROWS_PER_STATEMENT))
  return out
}

// Inserts rows, or overwrites the given columns of rows that already exist.
// updated_at moves only when another column really changed, so running the
// import again with nothing new in Airtable leaves every row as it was.
importRouter.post('/upsert', async (req, res) => {
  const { name, table, columns, data } = payload(req.body)
  const others = columns.filter((c) => !table.primaryKey.includes(c) && c !== 'updated_at')
  const assignments = others.map((c) => `${c} = excluded.${c}`)
  if (columns.includes('updated_at') && others.length) {
    const changed = others.map((c) => `${name}.${c} IS NOT excluded.${c}`).join(' OR ')
    assignments.push(`updated_at = CASE WHEN ${changed} THEN excluded.updated_at ELSE ${name}.updated_at END`)
  }
  const onConflict = assignments.length ? `DO UPDATE SET ${assignments.join(', ')}` : 'DO NOTHING'
  if (data.length) {
    await batch(
      chunks(data).map((slice) =>
        sql(
          `INSERT INTO ${name} (${columns.join(', ')}) SELECT ${fromJson(columns)} FROM json_each(?) WHERE true
           ON CONFLICT (${table.primaryKey.join(', ')}) ${onConflict}`,
          list(slice),
        ),
      ),
    )
  }
  res.json({ rows: data.length })
})

// Sets the given columns on existing rows. Used for link columns, which are
// filled only after every table is loaded so each link has something to point at.
importRouter.post('/update', async (req, res) => {
  const { name, table, columns, data } = payload(req.body)
  const [key] = table.primaryKey
  const others = columns.filter((c) => c !== key)
  if (table.primaryKey.length !== 1 || others.length === 0) throw badRequest('update needs an id column and at least one other')
  if (data.length) {
    await batch(
      chunks(data).map((slice) =>
        sql(
          `UPDATE ${name} SET ${others.map((c) => `${c} = json_extract(e.value, '$[${columns.indexOf(c)}]')`).join(', ')}
           FROM json_each(?) e WHERE ${name}.${key} = json_extract(e.value, '$[${columns.indexOf(key)}]')`,
          list(slice),
        ),
      ),
    )
  }
  res.json({ rows: data.length })
})

// Replaces the whole content of a link table in one transaction
importRouter.post('/replace', async (req, res) => {
  const { name, columns, data } = payload(req.body)
  await batch([
    sql(`DELETE FROM ${name}`),
    ...chunks(data).map((slice) =>
      sql(`INSERT INTO ${name} (${columns.join(', ')}) SELECT ${fromJson(columns)} FROM json_each(?)`, list(slice)),
    ),
  ])
  res.json({ rows: data.length })
})

// Deletes rows whose id is not in the list: records that are gone from Airtable
importRouter.post('/prune', async (req, res) => {
  const name = req.body?.table
  const table = typeof name === 'string' ? TABLES.get(name) : undefined
  const ids = req.body?.ids
  if (!table || table.primaryKey.length !== 1) throw badRequest(`Unknown table ${String(name)}`)
  if (!Array.isArray(ids)) throw badRequest('ids must be a list')
  const deleted = await rows(
    sql(`DELETE FROM ${name} WHERE ${table.primaryKey[0]} NOT IN (SELECT value FROM json_each(?)) RETURNING ${table.primaryKey[0]} AS id`, list(ids)),
  )
  res.json({ deleted: deleted.map((row) => row.id) })
})

// Read-only SQL for the verification report, and `PRAGMA optimize` after a load
importRouter.post('/query', async (req, res) => {
  const text = req.body?.sql
  const params = req.body?.params ?? []
  if (typeof text !== 'string' || !/^\s*(select|with)\b/i.test(text) && text.trim() !== 'PRAGMA optimize') {
    throw badRequest('Only SELECT statements are allowed')
  }
  if (text.includes(';') || !Array.isArray(params)) throw badRequest('One statement, with a list of params')
  res.json({ rows: await rows(sql(text, ...params)) })
})
