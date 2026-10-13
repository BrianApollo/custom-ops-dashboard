import type { FieldMapping } from '@ops/shared'
import type { AuthUser } from '../auth/session'
import { IN_LIST, list, sql } from '../lib/d1'
import { forbidden, invalid } from '../lib/errors'
import { attachmentId, RECORD_ID } from '../lib/ids'
import { keyFromUrl } from '../lib/storage'
import { canSeeSecrets, NEVER_FIELDS, ruleFor, SECRET_FIELDS, type OwnRule } from '../permissions'
import type { TableMeta } from './registry'

type Junction = Extract<FieldMapping, { kind: 'junction' }>

interface FilePlan {
  // the D1-side attachment field name
  field: string
  // every attachment id the field should hold, in order
  order: string[]
  added: { id: string; key: string; filename: string }[]
}

export interface WritePlan {
  columns: Record<string, unknown>
  links: { field: Junction; ids: string[] }[]
  files: FilePlan[]
}

// The frontend sends the whole list: `{ id }` for a file to keep and
// `{ url, filename }` for one it has just uploaded to our bucket
function filePlan(name: string, field: string, value: unknown): FilePlan {
  const plan: FilePlan = { field, order: [], added: [] }
  if (isEmpty(value)) return plan
  if (!Array.isArray(value)) throw invalid(`${name} must be a list of files`, name)
  for (const item of value) {
    if (typeof item?.id === 'string') {
      plan.order.push(item.id)
      continue
    }
    const key = keyFromUrl(item?.url, name)
    const id = attachmentId()
    const filename = typeof item.filename === 'string' && item.filename ? item.filename : key.split('/').pop()!
    plan.order.push(id)
    plan.added.push({ id, key, filename })
  }
  return plan
}

function fileStatements(meta: TableMeta, recordId: string, plan: FilePlan, now: string, isNew: boolean) {
  const scope = [meta.name, recordId, plan.field]
  const statements: D1PreparedStatement[] = []
  if (!isNew) {
    statements.push(
      sql(
        `DELETE FROM attachments WHERE table_name = ? AND record_id = ? AND field_name = ? AND id NOT IN ${IN_LIST}`,
        ...scope,
        list(plan.order),
      ),
    )
  }
  for (const file of plan.added) {
    statements.push(
      sql(
        `INSERT INTO attachments (id, table_name, record_id, field_name, position, filename, r2_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        file.id,
        ...scope,
        plan.order.indexOf(file.id),
        file.filename,
        file.key,
        now,
      ),
    )
  }
  if (!isNew && plan.order.length > plan.added.length) {
    statements.push(
      sql(
        `UPDATE attachments SET position = (SELECT e.key FROM json_each(?1) e WHERE e.value = attachments.id)
         WHERE table_name = ?2 AND record_id = ?3 AND field_name = ?4 AND id IN (SELECT value FROM json_each(?1))`,
        list(plan.order),
        ...scope,
      ),
    )
  }
  return statements
}

const isEmpty = (value: unknown) =>
  value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0)

function recordIds(name: string, value: unknown): string[] {
  const ids = Array.isArray(value) ? value : [value]
  for (const id of ids) {
    if (typeof id !== 'string' || !RECORD_ID.test(id)) throw invalid(`${name} must hold record ids`, name)
  }
  return [...new Set(ids as string[])]
}

function columnValue(name: string, type: string, value: unknown): unknown {
  if (type === 'checkbox') {
    if (isEmpty(value)) return 0
    if (typeof value !== 'boolean') throw invalid(`${name} must be true or false`, name)
    return value ? 1 : 0
  }
  if (isEmpty(value)) return null
  switch (type) {
    case 'text':
      if (typeof value === 'string') return value
      if (typeof value === 'number') return String(value)
      throw invalid(`${name} must be text`, name)
    case 'integer':
    case 'real': {
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
      if (typeof n !== 'number' || !Number.isFinite(n) || (type === 'integer' && !Number.isInteger(n))) {
        throw invalid(`${name} must be a ${type === 'integer' ? 'whole number' : 'number'}`, name)
      }
      return n
    }
    default:
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
        throw invalid(`${name} must be a list of text values`, name)
      }
      return JSON.stringify(value)
  }
}

// Validates the `fields` object of a request and splits it into column values
// and link lists. `""`, `null` and `[]` clear a field.
export function planWrite(meta: TableMeta, input: unknown, user: AuthUser, own?: OwnRule): WritePlan {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw invalid('fields must be an object')
  }
  const only = ruleFor(user.role, meta.name).readFields
  const plan: WritePlan = { columns: {}, links: [], files: [] }

  for (const [name, value] of Object.entries(input)) {
    const field = meta.fields.get(name)
    if (!field) throw invalid(`Unknown field ${name}`, name)
    if (
      NEVER_FIELDS.has(name) ||
      (SECRET_FIELDS.has(name) && !canSeeSecrets(user.role)) ||
      (only && !only.includes(name)) ||
      (own && !own.fields.includes(name))
    ) {
      throw forbidden(`You may not change ${name}`, name)
    }
    if (meta.readOnly.has(name) || field.kind === 'computed' || field.kind === 'inverse') {
      throw invalid(`${name} is read-only`, name)
    }

    switch (field.kind) {
      case 'column':
        plan.columns[field.column] = columnValue(name, field.type, value)
        break
      case 'fk': {
        const ids = isEmpty(value) ? [] : recordIds(name, value)
        if (ids.length > 1) throw invalid(`${name} can hold only one record`, name)
        plan.columns[field.column] = ids[0] ?? null
        break
      }
      case 'junction':
        plan.links.push({ field, ids: isEmpty(value) ? [] : recordIds(name, value) })
        break
      case 'attachment':
        plan.files.push(filePlan(name, field.field, value))
        break
    }
  }
  return plan
}

const otherPosition = (field: Junction) => `position_in_${field.otherColumn.replace(/_id$/, '')}`

// Makes the junction rows for one record match `ids`, in that order. A link
// that already exists keeps its place in the other record's list; a new one
// goes to the end of it. Two statements whatever the number of ids.
function linkStatements(field: Junction, id: string, ids: string[], isNew: boolean) {
  const { table, selfColumn, otherColumn, positionColumn } = field
  const statements: D1PreparedStatement[] = []
  if (!isNew) {
    statements.push(
      sql(
        `DELETE FROM ${table} WHERE ${selfColumn} = ?1 AND ${otherColumn} NOT IN (SELECT value FROM json_each(?2))`,
        id,
        list(ids),
      ),
    )
  }
  if (ids.length) {
    statements.push(
      sql(
        `INSERT INTO ${table} (${selfColumn}, ${otherColumn}, ${positionColumn}, ${otherPosition(field)})
         SELECT ?1, e.value, e.key,
           coalesce((SELECT max(x.${otherPosition(field)}) + 1 FROM ${table} x WHERE x.${otherColumn} = e.value), 0)
         FROM json_each(?2) e WHERE true
         ON CONFLICT (${selfColumn}, ${otherColumn}) DO UPDATE SET ${positionColumn} = excluded.${positionColumn}`,
        id,
        list(ids),
      ),
    )
  }
  return statements
}

// Adds links to the end of a record's list without touching the ones already there
export function appendLinkStatement(field: Junction, id: string, ids: string[]) {
  const { table, selfColumn, otherColumn, positionColumn } = field
  return sql(
    `INSERT INTO ${table} (${selfColumn}, ${otherColumn}, ${positionColumn}, ${otherPosition(field)})
     SELECT ?1, e.value,
       coalesce((SELECT max(x.${positionColumn}) + 1 FROM ${table} x WHERE x.${selfColumn} = ?1), 0) + e.key,
       coalesce((SELECT max(x.${otherPosition(field)}) + 1 FROM ${table} x WHERE x.${otherColumn} = e.value), 0)
     FROM json_each(?2) e WHERE true
     ON CONFLICT (${selfColumn}, ${otherColumn}) DO NOTHING`,
    id,
    list(ids),
  )
}

function touched(meta: TableMeta, columns: Record<string, unknown>, now: string) {
  const out = { ...columns }
  for (const [column, stamp] of Object.entries(meta.touch)) {
    if (column in columns) out[stamp] = now
  }
  return out
}

// `computed` lets a caller fill a column from SQL instead of a value
export function createStatements(
  meta: TableMeta,
  id: string,
  plan: WritePlan,
  now: string,
  computed: Record<string, { sql: string; params: unknown[] }> = {},
) {
  const columns = { id, ...touched(meta, plan.columns, now), created_at: now, updated_at: now }
  const names = [...Object.keys(columns), ...Object.keys(computed)]
  const placeholders = [...Object.keys(columns).map(() => '?'), ...Object.values(computed).map((c) => c.sql)]
  const params = [...Object.values(columns), ...Object.values(computed).flatMap((c) => c.params)]
  return [
    sql(`INSERT INTO ${meta.name} (${names.join(', ')}) VALUES (${placeholders.join(', ')})`, ...params),
    ...plan.links.flatMap(({ field, ids }) => linkStatements(field, id, ids, true)),
    ...plan.files.flatMap((files) => fileStatements(meta, id, files, now, true)),
  ]
}

export function updateStatements(meta: TableMeta, id: string, plan: WritePlan, now: string) {
  const columns = { ...touched(meta, plan.columns, now), updated_at: now }
  const assignments = Object.keys(columns).map((column) => `${column} = ?`)
  return [
    sql(`UPDATE ${meta.name} SET ${assignments.join(', ')} WHERE id = ?`, ...Object.values(columns), id),
    ...plan.links.flatMap(({ field, ids }) => linkStatements(field, id, ids, false)),
    ...plan.files.flatMap((files) => fileStatements(meta, id, files, now, false)),
  ]
}
