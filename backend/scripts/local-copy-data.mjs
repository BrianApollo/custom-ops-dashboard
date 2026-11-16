// Fills the LOCAL database with a read-only copy of one live dashboard database,
// with every credential removed, so the dashboard can be clicked through locally
// with realistic data that cannot reach any real ad account.
//
//   COPY_CF_API_TOKEN=... npm run local:copy -- --account-id <id> --database-id <id>
//   (or COPY_CF_ACCOUNT_ID / COPY_D1_DATABASE_ID), --dry to print the plan,
//   --tables a,b to limit, --no-seed to skip the test-login seed afterwards.
//
// Source side: only SELECT statements built here from schema identifiers are ever
// sent (see sourceQuery). Credential columns are replaced by NULL inside the
// SELECT, so their values never leave Cloudflare.
// Local side: everything goes through wrangler with --local (local-lib.mjs).
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { randomBytes } from 'node:crypto'
import { NEVER_FIELDS, SECRET_FIELDS } from '../src/permissions.ts'
import { TABLES } from '../../shared/src/airtable-map.ts'
import { assertLocalConfig, assertLocalStateDir, childEnv, localDir, stateDir, wranglerAt } from './local-lib.mjs'

export const SKIP_TABLES = new Set(['sessions', 'audit_log', 'idempotency_keys', 'rate_limits', 'jobs', 'd1_migrations'])
const INTERNAL_TABLE = /^(sqlite_|_cf_|d1_)/i

export const CREDENTIAL_NAME = /pass(word)?|token|secret|2fa|otp|recovery|proxy|cookie|api_?key/i

// Columns the name rule catches that are kept. Each must be an integer flag
// (checked against the local schema); none holds a credential value.
export const NAME_RULE_EXCEPTIONS = [
  'profiles.token_valid',
  'profiles.sop_5_password',
  'profiles.sop_6_2fa_recovery',
]

// Free-text columns on Facebook profiles where staff may have typed logins or
// access notes. Blanked as well, when the column exists.
export const FREE_TEXT_BLANK = [
  'profiles.extra_notes',
  'profiles.linked_ads_profile',
  'profile_setup_summary.notes',
  'profile_setup_summary.to_do',
  'profile_setup_summary.team_access',
]

export const DEFAULT_PAGE_SIZE = 500
export const MIN_PAGE_SIZE = 25
export const PAGE_PAUSE_MS = 150
export const MAX_TRIES = 5

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
export const ident = (name) => {
  if (!IDENT.test(name)) throw new Error(`Unexpected identifier ${JSON.stringify(name)}`)
  return `"${name}"`
}

// ---------------------------------------------------------------- source guard

export function assertSelectOnly(sql) {
  if (typeof sql !== 'string' || !/^SELECT\b/.test(sql) || sql.includes(';')) {
    throw new Error(`Refusing to send a non-SELECT statement to the source database: ${String(sql).slice(0, 80)}`)
  }
  return sql
}

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))

export class SourceError extends Error {
  constructor(status, body) {
    super(`source query failed with HTTP ${status}: ${String(body).slice(0, 300)}`)
    this.status = status
    this.body = body
  }
}

export const isSizeError = (status, body) =>
  status >= 400 && status !== 429 && (status === 413 || /too ?(big|large)|size|exceed|SQLITE_TOOBIG/i.test(String(body)))

// Every request to the source goes through here.
export async function sourceQuery(source, sql, params = []) {
  assertSelectOnly(sql)
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(source.accountId)}/d1/database/${encodeURIComponent(source.databaseId)}/query`
  const sleep = source.sleep ?? sleepMs
  let lastError
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const response = await source.fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${source.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }),
    })
    const text = await response.text()
    if (response.ok) {
      const body = JSON.parse(text)
      if (body.success === false) throw new SourceError(response.status, JSON.stringify(body.errors ?? body))
      const first = Array.isArray(body.result) ? body.result[0] : body.result
      return first?.results ?? []
    }
    lastError = new SourceError(response.status, text)
    if (isSizeError(response.status, text)) throw lastError
    if (response.status === 429 || response.status >= 500) {
      if (attempt < MAX_TRIES) await sleep(500 * 2 ** (attempt - 1))
      continue
    }
    throw lastError
  }
  throw lastError
}

// ---------------------------------------------------------------- schema

// D1 refuses pragma reads on its own _cf_ tables (SQLITE_AUTH), so they are left out here
const USER_TABLES = "m.type = 'table' AND m.name NOT LIKE '\\_cf\\_%' ESCAPE '\\' AND m.name NOT LIKE 'sqlite\\_%' ESCAPE '\\'"
export const SCHEMA_SQL = `SELECT m.name AS t, p.name AS col, p.type AS type, p.pk AS pk, p."notnull" AS nn FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE ${USER_TABLES} ORDER BY m.name, p.cid`
export const FK_SQL = `SELECT m.name AS t, f."table" AS parent FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f WHERE ${USER_TABLES}`

// rows from SCHEMA_SQL + FK_SQL -> Map(table -> { columns: [{name,type,pk,notnull}], parents: Set })
export function schemaFromRows(columnRows, fkRows) {
  const schema = new Map()
  for (const row of columnRows) {
    if (!schema.has(row.t)) schema.set(row.t, { columns: [], parents: new Set() })
    schema.get(row.t).columns.push({ name: row.col, type: String(row.type ?? '').toLowerCase(), pk: Number(row.pk), notnull: Number(row.nn) === 1 })
  }
  for (const row of fkRows) schema.get(row.t)?.parents.add(row.parent)
  return schema
}

export const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url))

// The schema the migrations produce, built in memory (used by tests and as a cross-check)
export async function schemaFromMigrations() {
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(':memory:')
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(readFileSync(join(migrationsDir, file), 'utf8'))
  }
  const schema = schemaFromRows(db.prepare(SCHEMA_SQL).all(), db.prepare(FK_SQL).all())
  return { schema, db }
}

export function readLocalSchema(persistTo) {
  const query = (sql) => JSON.parse(wranglerAt(persistTo, ['d1', 'execute', 'DB', '--json', '--command', sql], { capture: true }))[0].results
  return schemaFromRows(query(SCHEMA_SQL), query(FK_SQL))
}

// ---------------------------------------------------------------- plan

export function tableSelection(schema, only) {
  const copy = []
  const skipped = []
  for (const table of [...schema.keys()].sort()) {
    if (SKIP_TABLES.has(table) || INTERNAL_TABLE.test(table)) skipped.push(table)
    else copy.push(table)
  }
  if (!only) return { copy, skipped }
  const unknown = only.filter((t) => !copy.includes(t))
  if (unknown.length) throw new Error(`--tables names tables that are not copied: ${unknown.join(', ')}`)
  return { copy: copy.filter((t) => only.includes(t)), skipped: [...skipped, ...copy.filter((t) => !only.includes(t)).map((t) => `${t} (not in --tables)`)] }
}

// Every table.column to blank, with the reason. Throws when a NEVER/SECRET field
// cannot be mapped to a stored column of the local schema.
export function scrubList(schema) {
  const out = new Map()
  const add = (table, column, reason) => {
    const key = `${table}.${column}`
    out.set(key, out.has(key) ? `${out.get(key)}, ${reason}` : reason)
  }
  const hasColumn = (table, column) => schema.get(table)?.columns.some((c) => c.name === column)

  for (const field of [...NEVER_FIELDS, ...SECRET_FIELDS]) {
    const reason = NEVER_FIELDS.has(field) ? `NEVER_FIELDS "${field}"` : `SECRET_FIELDS "${field}"`
    const hits = []
    for (const mapping of TABLES) {
      const fieldMap = mapping.fields[field]
      if (!fieldMap) continue
      if (fieldMap.kind !== 'column') throw new Error(`Field "${field}" in ${mapping.d1Table} is ${fieldMap.kind}, not a stored column; cannot blank it`)
      if (!hasColumn(mapping.d1Table, fieldMap.column)) throw new Error(`Field "${field}" maps to ${mapping.d1Table}.${fieldMap.column}, which is not in the local schema`)
      hits.push([mapping.d1Table, fieldMap.column])
    }
    if (!hits.length) throw new Error(`Field "${field}" is not mapped in airtable-map.ts; cannot blank it`)
    for (const [table, column] of hits) add(table, column, reason)
  }

  if (!hasColumn('users', 'password')) throw new Error('users.password is not in the local schema')
  add('users', 'password', 'user password')

  for (const entry of FREE_TEXT_BLANK) {
    const [table, column] = entry.split('.')
    if (hasColumn(table, column)) add(table, column, 'profile free text')
  }

  for (const exception of NAME_RULE_EXCEPTIONS) {
    const [table, column] = exception.split('.')
    const col = schema.get(table)?.columns.find((c) => c.name === column)
    if (col && col.type !== 'integer') throw new Error(`Exception ${exception} is ${col.type}, not an integer flag`)
  }
  for (const [table, { columns }] of schema) {
    if (SKIP_TABLES.has(table) || INTERNAL_TABLE.test(table)) continue
    for (const { name } of columns) {
      if (!CREDENTIAL_NAME.test(name)) continue
      if (NAME_RULE_EXCEPTIONS.includes(`${table}.${name}`)) continue
      add(table, name, 'name rule')
    }
  }
  return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

export const orderKey = (columns) => {
  const pk = columns.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk)
  return pk.length ? pk.map((c) => ident(c.name)).join(', ') : 'rowid'
}

// The page SELECT for one table: kept columns as-is, blanked columns as NULL ('' when NOT NULL)
export function buildPageSql(table, columns, blanked) {
  const list = columns.map((c) => {
    if (!blanked.has(`${table}.${c.name}`)) return ident(c.name)
    return `${c.notnull ? "''" : 'NULL'} AS ${ident(c.name)}`
  })
  return `SELECT ${list.join(', ')} FROM ${ident(table)} ORDER BY ${orderKey(columns)} LIMIT ? OFFSET ?`
}

// Parents before children; tables outside `tables` are ignored
export function loadOrder(schema, tables) {
  const done = []
  const seen = new Set()
  const visit = (table, path) => {
    if (seen.has(table)) return
    if (path.has(table)) throw new Error(`Foreign key cycle at ${table}`)
    path.add(table)
    for (const parent of schema.get(table).parents) if (parent !== table && tables.includes(parent)) visit(parent, path)
    path.delete(table)
    seen.add(table)
    done.push(table)
  }
  for (const table of [...tables].sort()) visit(table, new Set())
  return done
}

// ---------------------------------------------------------------- fetch

export async function fetchTable(source, table, columns, blanked, onPage, { pageSize = DEFAULT_PAGE_SIZE, pause = PAGE_PAUSE_MS } = {}) {
  const sql = buildPageSql(table, columns, blanked)
  const sleep = source.sleep ?? sleepMs
  let size = pageSize
  let offset = 0
  let total = 0
  let first = true
  for (;;) {
    if (!first) await sleep(pause)
    first = false
    let rows
    try {
      rows = await sourceQuery(source, sql, [size, offset])
    } catch (error) {
      if (error instanceof SourceError && isSizeError(error.status, error.body) && size > MIN_PAGE_SIZE) {
        size = Math.max(MIN_PAGE_SIZE, Math.floor(size / 2))
        console.log(`  ${table}: page too large, retrying with ${size} rows per page`)
        continue
      }
      throw error
    }
    if (rows.length) onPage(rows)
    total += rows.length
    offset += rows.length
    if (rows.length < size) return total
  }
}

export async function sourceColumns(source, table) {
  const rows = await sourceQuery(source, 'SELECT name FROM pragma_table_info(?)', [table])
  return rows.map((r) => r.name)
}

// ---------------------------------------------------------------- local SQL

export const sqlValue = (value) => {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'`
  return `'${String(value).replace(/'/g, "''")}'`
}

// SQLite refuses a statement above a size limit, so statements are cut by
// size, not by row count. A single row that is too big on its own (a campaign
// with a large launch snapshot) is inserted with its long text values empty,
// then filled by appending pieces, matched on the primary key.
export const MAX_STATEMENT_CHARS = 60_000
export const LONG_VALUE_CHARS = 20_000

const rawText = (value) => (typeof value === 'object' && value !== null ? JSON.stringify(value) : value)

export function insertSql(table, columns, rows, { pk = [], maxChars = MAX_STATEMENT_CHARS, longChars = LONG_VALUE_CHARS } = {}) {
  const head = `INSERT INTO ${ident(table)} (${columns.map(ident).join(', ')}) VALUES\n`
  const out = []
  let pending = []
  let size = 0
  const flush = () => {
    if (pending.length) out.push(head + pending.join(',\n') + ';\n')
    pending = []
    size = 0
  }
  for (const row of rows) {
    const tuple = `(${columns.map((c) => sqlValue(row[c])).join(', ')})`
    if (head.length + tuple.length <= maxChars) {
      if (size + tuple.length > maxChars) flush()
      pending.push(tuple)
      size += tuple.length
      continue
    }
    flush()
    if (!pk.length || pk.some((k) => row[k] === null || row[k] === undefined)) {
      throw new Error(`A row of ${table} is too large to load and the table has no primary key to fill it in pieces`)
    }
    const long = columns.filter((c) => !pk.includes(c) && typeof rawText(row[c]) === 'string' && rawText(row[c]).length > longChars)
    const short = `(${columns.map((c) => (long.includes(c) ? "''" : sqlValue(row[c]))).join(', ')})`
    if (head.length + short.length > maxChars) throw new Error(`A row of ${table} is too large to load even without its long text values`)
    out.push(head + short + ';\n')
    const where = pk.map((k) => `${ident(k)} = ${sqlValue(row[k])}`).join(' AND ')
    for (const c of long) {
      const text = rawText(row[c])
      for (let i = 0; i < text.length; i += longChars) {
        out.push(`UPDATE ${ident(table)} SET ${ident(c)} = ${ident(c)} || ${sqlValue(text.slice(i, i + longChars))} WHERE ${where};\n`)
      }
    }
  }
  flush()
  return out.join('')
}

// ---------------------------------------------------------------- run

function printPlan(plan, log = console.log) {
  log(`Tables to copy (${plan.copy.length}): ${plan.copy.join(', ')}`)
  log(`Tables skipped (${plan.skipped.length}): ${plan.skipped.join(', ')}`)
  log(`Blanked columns (${plan.blanked.size}), replaced by NULL in the source SELECT:`)
  for (const [key, reason] of plan.blanked) log(`  ${key.padEnd(40)} ${reason}`)
  log(`Kept although the name rule matches (integer flags): ${NAME_RULE_EXCEPTIONS.join(', ') || 'none'}`)
}

function makePlan(schema, only) {
  const { copy, skipped } = tableSelection(schema, only)
  return { copy, skipped, blanked: scrubList(schema), order: loadOrder(schema, copy) }
}

export async function runCopy({ source, persistTo = stateDir, only = null, dry = false, seed = true, pageSize = DEFAULT_PAGE_SIZE, log = console.log }) {
  assertLocalStateDir(persistTo)
  assertLocalConfig()
  const schema = readLocalSchema(persistTo)
  const plan = makePlan(schema, only)
  printPlan(plan, log)

  const subset = only !== null
  if (subset) log('Warning: copying a subset. Rows in other local tables that point at the wiped tables lose those links (ON DELETE SET NULL / CASCADE).')

  const columnsByTable = new Map()
  for (const table of plan.order) {
    if (!source) break
    const local = schema.get(table).columns
    const remote = await sourceColumns(source, table)
    if (!remote.length) {
      log(`  ${table}: not in the source database, local table will be emptied`)
      columnsByTable.set(table, [])
      continue
    }
    const kept = local.filter((c) => remote.includes(c.name))
    const onlyLocal = local.filter((c) => !remote.includes(c.name)).map((c) => c.name)
    const onlySource = remote.filter((n) => !local.some((c) => c.name === n))
    if (onlyLocal.length) log(`  ${table}: only in local (left at default): ${onlyLocal.join(', ')}`)
    if (onlySource.length) log(`  ${table}: only in source (not copied): ${onlySource.join(', ')}`)
    columnsByTable.set(table, kept)
  }
  if (dry) {
    if (!source) log('Dry run without source credentials: source columns not compared.')
    for (const table of plan.order) {
      const cols = columnsByTable.get(table) ?? schema.get(table).columns
      const kept = cols.filter((c) => !plan.blanked.has(`${table}.${c.name}`)).map((c) => c.name)
      log(`  ${table}: keep ${kept.join(', ')}`)
    }
    log('Dry run: no rows fetched, nothing written.')
    return { plan, dry: true }
  }

  mkdirSync(localDir, { recursive: true })
  const file = join(localDir, `copy-${randomBytes(6).toString('hex')}.sql`)
  const counts = {}
  const cleanup = () => rmSync(file, { force: true })
  process.on('exit', cleanup)
  try {
    writeFileSync(file, 'PRAGMA defer_foreign_keys = ON;\n')
    for (const table of [...plan.order].reverse()) appendFileSync(file, `DELETE FROM ${ident(table)};\n`)
    for (const table of plan.order) {
      const cols = columnsByTable.get(table)
      if (!cols.length) {
        counts[table] = { source: 0, fetched: 0 }
        continue
      }
      const [{ n }] = await sourceQuery(source, `SELECT count(*) AS n FROM ${ident(table)}`)
      const names = cols.map((c) => c.name)
      const fetched = await fetchTable(source, table, cols, plan.blanked, (rows) => appendFileSync(file, insertSql(table, names, rows, { pk: cols.filter((c) => c.pk > 0).map((c) => c.name) })), { pageSize })
      counts[table] = { source: Number(n), fetched }
      log(`  ${table}: fetched ${fetched} of ${n}`)
    }
    if (plan.order.includes('users')) appendFileSync(file, 'UPDATE "users" SET "active" = 0;\n')
    wranglerAt(persistTo, ['d1', 'execute', 'DB', '--file', file], { capture: true })
  } finally {
    cleanup()
    process.off('exit', cleanup)
  }

  const verification = verifyLocal(persistTo, plan, counts, log)
  if (!verification.ok) throw new Error('Verification failed: see the table above')

  if (seed) {
    if (resolve(persistTo) !== resolve(stateDir)) {
      log('Seed skipped: it only runs against the default local state.')
    } else {
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('./local-seed.mjs', import.meta.url))], { stdio: 'inherit', env: childEnv() })
      if (result.status !== 0) throw new Error('local-seed failed')
    }
  }
  return { plan, counts, verification }
}

export function verifyLocal(persistTo, plan, counts, log = console.log) {
  const query = (sql) => JSON.parse(wranglerAt(persistTo, ['d1', 'execute', 'DB', '--json', '--command', sql], { capture: true }))[0].results[0]
  const countSql = `SELECT ${plan.order.map((t) => `(SELECT count(*) FROM ${ident(t)}) AS ${ident(t)}`).join(', ')}`
  const local = plan.order.length ? query(countSql) : {}
  let ok = true
  log('\nRow counts (source count / fetched / local):')
  for (const table of plan.order) {
    const c = counts[table]
    const match = c.fetched === local[table]
    if (!match) ok = false
    log(`  ${match ? 'PASS' : 'FAIL'}  ${table.padEnd(32)} ${c.source} / ${c.fetched} / ${local[table]}${c.source !== c.fetched ? '  (source changed while copying)' : ''}`)
  }
  const blanked = [...plan.blanked.keys()].filter((key) => plan.order.includes(key.split('.')[0]))
  const nonNull = {}
  if (blanked.length) {
    const parts = blanked.map((key, i) => {
      const [t, c] = key.split('.')
      return `(SELECT count(*) FROM ${ident(t)} WHERE ${ident(c)} IS NOT NULL AND ${ident(c)} <> '') AS "b${i}"`
    })
    const row = query(`SELECT ${parts.join(', ')}`)
    blanked.forEach((key, i) => (nonNull[key] = row[`b${i}`]))
  }
  log('\nBlanked columns, non-empty values in the local copy (must be 0):')
  for (const key of blanked) {
    if (nonNull[key] !== 0) ok = false
    log(`  ${nonNull[key] === 0 ? 'PASS' : 'FAIL'}  ${key.padEnd(40)} ${nonNull[key]}`)
  }
  log(ok ? '\nVERIFY PASS' : '\nVERIFY FAIL')
  return { ok, local, nonNull }
}

export function parseArgs(argv, env) {
  const opts = { accountId: env.COPY_CF_ACCOUNT_ID, databaseId: env.COPY_D1_DATABASE_ID, dry: false, seed: true, only: null }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const [name, inline] = arg.split(/=(.*)/s)
    const value = () => (inline !== undefined ? inline : argv[++i])
    if (/token/i.test(name)) throw new Error('The API token is read from COPY_CF_API_TOKEN only, never from a flag.')
    if (name === '--account-id') opts.accountId = value()
    else if (name === '--database-id') opts.databaseId = value()
    else if (name === '--tables') opts.only = value().split(',').map((t) => t.trim()).filter(Boolean)
    else if (name === '--dry') opts.dry = true
    else if (name === '--no-seed') opts.seed = false
    else throw new Error(`Unknown argument ${name}`)
  }
  return opts
}

async function main() {
  let opts
  try {
    opts = parseArgs(process.argv.slice(2), process.env)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
  assertLocalConfig()
  const token = process.env.COPY_CF_API_TOKEN
  const haveSource = Boolean(token && opts.accountId && opts.databaseId)
  if (!haveSource && !opts.dry) {
    console.error('Need COPY_CF_API_TOKEN plus --account-id/--database-id (or COPY_CF_ACCOUNT_ID/COPY_D1_DATABASE_ID).')
    process.exit(1)
  }
  const source = haveSource ? { accountId: opts.accountId, databaseId: opts.databaseId, token, fetch: globalThis.fetch } : null
  try {
    await runCopy({ source, only: opts.only, dry: opts.dry, seed: opts.seed })
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
