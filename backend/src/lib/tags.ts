// Pure helpers for asset tags: no settings or database import, so tests can load them.
import { badRequest } from './errors'

export interface TagRow {
  // tag key, value, and the tag type's kind and multi flag (null when the type is not listed)
  k: string
  v: string
  kind?: string | null
  m?: number | boolean | null
}

export type TagValue = string | number | boolean
export type TagMap = Record<string, TagValue | TagValue[]>

function typed(kind: string | null | undefined, value: string): TagValue {
  if (kind === 'flag') return value === 'true' || value === '1'
  if (kind === 'number') {
    const n = Number(value)
    return Number.isFinite(n) ? n : value
  }
  return value
}

// Rows of one asset's tags -> `{ key: value }`, or `{ key: [values] }` for a multi tag.
// A tag whose type is not listed is a single value unless it holds more than one.
export function tagsToMap(rows: TagRow[]): TagMap {
  const grouped = new Map<string, { multi: boolean; values: TagValue[] }>()
  for (const row of rows) {
    if (!row || typeof row.k !== 'string' || row.v === null || row.v === undefined) continue
    const entry = grouped.get(row.k) ?? { multi: Boolean(row.m), values: [] }
    entry.values.push(typed(row.kind, String(row.v)))
    grouped.set(row.k, entry)
  }
  const out: TagMap = {}
  for (const key of [...grouped.keys()].sort()) {
    const { multi, values } = grouped.get(key)!
    out[key] = multi || values.length > 1 ? values : values[0]
  }
  return out
}

// The decoded value of the `tags` column: a JSON array of TagRow
export function decodeTags(value: unknown): TagMap {
  if (typeof value !== 'string' || value === '') return {}
  try {
    const rows = JSON.parse(value)
    return Array.isArray(rows) ? tagsToMap(rows as TagRow[]) : {}
  } catch {
    return {}
  }
}

const TAG_PARAM = /^tag\[(.+)\]$/
const TAG_KEY = /^[a-z][a-z0-9_]*$/

export interface TagFilter {
  key: string
  value: string
}

// Splits `tag[<key>]=<value>` parameters (repeatable) from the rest of a query string.
// Every pair must match, so the same key given twice asks for both values.
export function parseTagFilter(query: Record<string, unknown>): { tags: TagFilter[]; rest: Record<string, unknown> } {
  const tags: TagFilter[] = []
  const rest: Record<string, unknown> = {}
  for (const [name, raw] of Object.entries(query)) {
    const match = TAG_PARAM.exec(name)
    if (!match) {
      rest[name] = raw
      continue
    }
    const key = match[1]
    if (!TAG_KEY.test(key)) throw badRequest(`Unknown tag ${key}`, `tag[${key}]`)
    for (const item of Array.isArray(raw) ? raw : [raw]) {
      if (typeof item !== 'string' || item.trim() === '') throw badRequest(`tag[${key}] needs a value`, `tag[${key}]`)
      const value = item.trim()
      if (!tags.some((t) => t.key === key && t.value === value)) tags.push({ key, value })
    }
  }
  return { tags, rest }
}

// One EXISTS condition per pair, over the list's row alias `t`
export function tagConditions(tags: TagFilter[]) {
  return {
    sql: tags.map(() => 'EXISTS (SELECT 1 FROM media_asset_tags x WHERE x.asset_id = t.id AND x.tag_key = ? AND x.value = ?)'),
    params: tags.flatMap((t) => [t.key, t.value]),
  }
}

// Assets of one product shared with its other language versions carry this multi tag, one value per product name
export const SHARED_TAG = 'shared_products'

// The Library's product filter: the product's own assets, plus the assets shared to it by name
export function productCondition(productId: string) {
  return {
    sql: `(t.product_id = ? OR EXISTS (SELECT 1 FROM media_asset_tags x WHERE x.asset_id = t.id AND x.tag_key = '${SHARED_TAG}' AND x.value = (SELECT p.product_name FROM products p WHERE p.id = ?)))`,
    params: [productId, productId],
  }
}
