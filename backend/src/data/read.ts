import type { AuthUser } from '../auth/session'
import { settings } from '../env'
import { IN_LIST, list, sql, type Row } from '../lib/d1'
import { badRequest } from '../lib/errors'
import { RECORD_ID } from '../lib/ids'
import { urlPath } from '../lib/storage'
import { canSeeSecrets, NEVER_FIELDS, ruleFor, SECRET_FIELDS } from '../permissions'
import { tableByName, type TableMeta } from './registry'

export interface ApiRecord {
  id: string
  createdTime: string
  updatedTime: string
  fields: Record<string, unknown>
}

// The fields this user may read. Secret and forbidden fields are dropped here,
// before any SQL is built, so they are never selected for the wrong role.
export function readableFields(meta: TableMeta, user: AuthUser, includeHidden = false) {
  const only = ruleFor(user.role, meta.name).readFields
  const names: string[] = []
  for (const [name, field] of meta.fields) {
    if (NEVER_FIELDS.has(name)) continue
    if (SECRET_FIELDS.has(name) && !canSeeSecrets(user.role)) continue
    if (only && !only.includes(name)) continue
    if (field.kind === 'computed' && !meta.computed[name]) continue
    if (!includeHidden && meta.hiddenByDefault.has(name)) continue
    names.push(name)
  }
  return names
}

const parseList = (value: unknown) => (typeof value === 'string' ? (JSON.parse(value) as unknown[]) : [])

function fileUrl(key: string) {
  const base = settings.PUBLIC_FILES_URL
  return base ? `${base.replace(/\/$/, '')}/${urlPath(key)}` : undefined
}

// Builds the SELECT list for the given fields and the function that turns a
// result row back into an Airtable-shaped record. Links, attachments and
// computed fields are subqueries, so one statement returns complete records.
export function project(meta: TableMeta, names: string[]) {
  const columns = ['t.id', 't.created_at', 't.updated_at']
  const decoders: ((row: Row, out: Record<string, unknown>) => void)[] = []

  names.forEach((name, i) => {
    const field = meta.fields.get(name)!
    const alias = `f${i}`
    const add = (expression: string, decode: (value: unknown, out: Record<string, unknown>) => void) => {
      columns.push(`${expression} AS ${alias}`)
      decoders.push((row, out) => decode(row[alias], out))
    }
    const addList = (expression: string) =>
      add(expression, (value, out) => {
        const items = parseList(value)
        if (items.length) out[name] = items
      })

    switch (field.kind) {
      case 'column':
        add(`t.${field.column}`, (value, out) => {
          if (value === null || value === '') return
          if (field.type === 'checkbox') {
            if (value) out[name] = true
          } else if (field.type === 'json') {
            const items = parseList(value)
            if (items.length) out[name] = items
          } else {
            out[name] = value
          }
        })
        break
      case 'fk':
        add(`t.${field.column}`, (value, out) => {
          if (value) out[name] = [value]
        })
        break
      case 'junction':
        addList(
          `(SELECT json_group_array(x) FROM (SELECT j.${field.otherColumn} AS x FROM ${field.table} j WHERE j.${field.selfColumn} = t.id ORDER BY j.${field.positionColumn}))`,
        )
        break
      case 'inverse':
        addList(
          `(SELECT json_group_array(x) FROM (SELECT o.id AS x FROM ${field.table} o WHERE o.${field.column} = t.id ORDER BY o.created_at, o.id))`,
        )
        break
      case 'attachment':
        add(
          `(SELECT json_group_array(json_object('id', a.id, 'filename', a.filename, 'key', a.r2_key, 'size', a.size_bytes, 'type', a.mime_type)) FROM (SELECT * FROM attachments WHERE table_name = '${meta.name}' AND record_id = t.id AND field_name = '${field.field}' ORDER BY position) a)`,
          (value, out) => {
            const files = parseList(value) as { id: string; filename: string; key: string; size: number; type: string }[]
            if (files.length) {
              out[name] = files.map(({ key, ...file }) => ({ ...file, url: fileUrl(key) }))
            }
          },
        )
        break
      case 'computed': {
        const computed = meta.computed[name]
        add(computed.sql, (value, out) => {
          if (computed.shape === 'flag') out[name] = Boolean(value)
          else if (value !== null && value !== '') out[name] = computed.shape === 'lookup' ? [value] : value
        })
        break
      }
    }
  })

  return {
    select: columns.join(', '),
    decode(row: Row): ApiRecord {
      const fields: Record<string, unknown> = {}
      for (const decode of decoders) decode(row, fields)
      return {
        id: row.id as string,
        createdTime: row.created_at as string,
        updatedTime: row.updated_at as string,
        fields,
      }
    },
  }
}

export type Projection = ReturnType<typeof project>

export const selectByIds = (meta: TableMeta, projection: Projection, ids: string[]) =>
  sql(`SELECT ${projection.select} FROM ${meta.name} t WHERE t.id IN ${IN_LIST}`, list(ids))

// rows come back in table order; put them in the order the ids were given
export function inOrder(records: ApiRecord[], ids: string[]) {
  const byId = new Map(records.map((r) => [r.id, r]))
  return ids.flatMap((id) => byId.get(id) ?? [])
}

export interface ListQuery {
  fields: string[]
  where: string
  params: unknown[]
  orderBy: string
  // null means the whole list in one response
  limit: number | null
  offset: number
}

// `text` anywhere in the value, with LIKE's own wildcards taken literally
export const CONTAINS = `LIKE ? ESCAPE '\\'`
export const containsParam = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`

// Tokenised search: every word of `search` somewhere in the column, in any order
export function containsWords(column: string, search: string) {
  const words = search.trim().split(/\s+/).filter(Boolean)
  return { sql: words.map(() => `${column} ${CONTAINS}`).join(' AND '), params: words.map(containsParam) }
}

export function wholeNumber(raw: unknown, name: string, min: number) {
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min) throw badRequest(`${name} must be a whole number of at least ${min}`)
  return n
}

// every record can be sorted by when it was created or last changed
const TIME_SORTS: Record<string, string> = { createdTime: 't.created_at', updatedTime: 't.updated_at' }

const PARAM = /^(where|whereAny|whereNotEmpty)\[(.+)\]$/

const values = (raw: unknown, split: boolean) =>
  (Array.isArray(raw) ? raw : [raw]).flatMap((v) => (split ? String(v).split(',') : [String(v)]))

function condition(meta: TableMeta, name: string, wanted: string[], params: unknown[]): string {
  const field = meta.fields.get(name)!
  const isIn = (expression: string, items: unknown[]) => {
    if (items.length === 1) {
      params.push(items[0])
      return `${expression} = ?`
    }
    params.push(list(items))
    return `${expression} IN ${IN_LIST}`
  }

  if (field.kind === 'column') {
    const column = `t.${field.column}`
    if (wanted.length === 1 && wanted[0] === '') return `(${column} IS NULL OR ${column} = '')`
    if (field.type === 'checkbox') {
      const on = ['true', '1'].includes(wanted[0])
      if (!on && !['false', '0'].includes(wanted[0])) throw badRequest(`${name} must be true or false`, name)
      return `${column} = ${on ? 1 : 0}`
    }
    if (field.type === 'integer' || field.type === 'real') {
      const numbers = wanted.map(Number)
      if (numbers.some(Number.isNaN)) throw badRequest(`${name} must be a number`, name)
      return isIn(column, numbers)
    }
    if (field.type === 'text') return isIn(column, wanted)
  }

  if (field.kind === 'fk' || field.kind === 'junction') {
    // record ids match directly; anything else is taken as the linked record's name
    const target = tableByName(field.target)
    let match: string
    if (wanted.every((v) => RECORD_ID.test(v))) {
      match = isIn('#', wanted)
    } else {
      params.push(list(wanted))
      match = `# IN (SELECT id FROM ${target.name} WHERE ${target.primaryColumn} IN ${IN_LIST})`
    }
    return field.kind === 'fk'
      ? match.replace('#', `t.${field.column}`)
      : `EXISTS (SELECT 1 FROM ${field.table} j WHERE j.${field.selfColumn} = t.id AND ${match.replace('#', `j.${field.otherColumn}`)})`
  }

  throw badRequest(`Cannot filter on ${name}`, name)
}

function notEmpty(meta: TableMeta, name: string): string {
  const field = meta.fields.get(name)!
  if (field.kind === 'column' || field.kind === 'fk') {
    return `(t.${field.column} IS NOT NULL AND t.${field.column} != '')`
  }
  if (field.kind === 'junction') {
    return `EXISTS (SELECT 1 FROM ${field.table} j WHERE j.${field.selfColumn} = t.id)`
  }
  throw badRequest(`Cannot filter on ${name}`, name)
}

// Turns the query string into SQL. Unknown parameters and fields are rejected.
export function parseListQuery(meta: TableMeta, user: AuthUser, query: Record<string, unknown>): ListQuery {
  const readable = new Set(readableFields(meta, user, true))
  const known = (name: string) => {
    if (!readable.has(name)) throw badRequest(`Unknown field ${name}`, name)
    return name
  }

  let fields = readableFields(meta, user)
  const where: string[] = []
  const params: unknown[] = []
  let orderBy = 't.created_at, t.id'
  let limit: number | null = null
  let offset = 0

  for (const [key, raw] of Object.entries(query)) {
    if (key === 'fields') {
      fields = values(raw, true).map((name) => known(name.trim()))
    } else if (key === 'sort') {
      const terms = values(raw, true).map((term) => {
        const descending = term.startsWith('-')
        const bare = descending ? term.slice(1) : term
        if (TIME_SORTS[bare]) return `${TIME_SORTS[bare]} ${descending ? 'DESC' : 'ASC'}`
        const name = known(bare)
        const field = meta.fields.get(name)!
        if (field.kind !== 'column' && field.kind !== 'fk') throw badRequest(`Cannot sort by ${name}`, name)
        const text = field.kind === 'column' && field.type === 'text' ? ' COLLATE NOCASE' : ''
        return `t.${field.column}${text} ${descending ? 'DESC' : 'ASC'}`
      })
      orderBy = [...terms, 't.id'].join(', ')
    } else if (key === 'limit') {
      limit = wholeNumber(raw, 'limit', 1)
    } else if (key === 'offset') {
      offset = wholeNumber(raw, 'offset', 0)
    } else if (key === 'search') {
      // matches the record's name, ignoring letter case
      if (String(raw).trim()) {
        const words = containsWords(`t.${meta.primaryColumn}`, String(raw))
        where.push(words.sql)
        params.push(...words.params)
      }
    } else {
      const match = PARAM.exec(key)
      if (!match) throw badRequest(`Unknown parameter ${key}`)
      const name = known(match[2])
      if (match[1] === 'whereNotEmpty') where.push(notEmpty(meta, name))
      else where.push(condition(meta, name, values(raw, match[1] === 'whereAny'), params))
    }
  }

  if (offset && limit === null) throw badRequest('offset needs a limit')
  return { fields, where: where.length ? ` WHERE ${where.join(' AND ')}` : '', params, orderBy, limit, offset }
}

export function listStatement(meta: TableMeta, projection: Projection, query: ListQuery) {
  const page = query.limit === null ? '' : ` LIMIT ${query.limit} OFFSET ${query.offset}`
  return sql(
    `SELECT ${projection.select} FROM ${meta.name} t${query.where} ORDER BY ${query.orderBy}${page}`,
    ...query.params,
  )
}

// how many rows match the filters, whatever page is being asked for
export const countStatement = (meta: TableMeta, query: ListQuery) =>
  sql(`SELECT count(*) AS n FROM ${meta.name} t${query.where}`, ...query.params)
