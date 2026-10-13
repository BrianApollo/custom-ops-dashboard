import { TABLES, type FieldMapping } from '@ops/shared'
import { badRequest } from '../lib/errors'

export interface ComputedField {
  // SQL expression over the row alias `t`
  sql: string
  // Airtable returns a lookup as a one-item array and a count or formula as a plain value
  // `flag` is always present, as true or false
  shape: 'value' | 'lookup' | 'flag'
}

// Fields that exist only in this API, not in Airtable
const API_ONLY: Record<string, Record<string, ComputedField>> = {
  profiles: {
    hasToken: { sql: `(t.permanent_token IS NOT NULL AND t.permanent_token != '')`, shape: 'flag' },
  },
  business_managers: {
    hasToken: { sql: `(t.system_user_token IS NOT NULL AND t.system_user_token != '')`, shape: 'flag' },
  },
}

export interface TableMeta {
  // D1 table name
  name: string
  // Airtable table name, used in messages
  label: string
  fields: Map<string, FieldMapping>
  // the column holding the row's display name, for filters that pass a name instead of an id
  primaryColumn: string
  computed: Record<string, ComputedField>
  // fields left out of list responses unless asked for with `fields=`
  hiddenByDefault: Set<string>
  // column -> timestamp column to stamp whenever it is written
  touch: Record<string, string>
  readOnly: Set<string>
}

// Computed Airtable fields the dashboard reads. Each is a correlated subquery
// that an index answers, so a list stays a single statement.
const COMPUTED: Record<string, Record<string, ComputedField>> = {
  video_scripts: {
    'Scripts To Do': {
      sql: `(SELECT count(*) FROM videos v WHERE v.script_id = t.id AND v.status = 'To Do')`,
      shape: 'value',
    },
    'Scripts Past To Do': {
      sql: `(SELECT count(*) FROM videos v WHERE v.script_id = t.id AND v.status != 'To Do')`,
      shape: 'value',
    },
    Calculation: {
      sql: `(SELECT CAST(count(CASE WHEN v.status != 'To Do' THEN 1 END) AS REAL) / nullif(count(v.status), 0) FROM videos v WHERE v.script_id = t.id)`,
      shape: 'value',
    },
  },
  videos: {
    'Script Content (from Script)': {
      sql: `(SELECT s.script_content FROM video_scripts s WHERE s.id = t.script_id)`,
      shape: 'lookup',
    },
    'Assigned At': { sql: 't.created_at', shape: 'value' },
  },
  schedule: {
    'Name (from Linked Campaign)': {
      sql: `(SELECT c.name FROM campaigns c WHERE c.id = t.campaign_id)`,
      shape: 'lookup',
    },
  },
}

// These tables are loaded whole on most pages and their reverse links fan out
// to thousands of ids (every video of a product, every log row of a rule)
const HIDE_REVERSE_LINKS = new Set(['products', 'users', 'scaling_rules'])

const TOUCH: Record<string, Record<string, string>> = {
  videos: { creative_link: 'creative_link_updated_at' },
  ai_videos: { creative_link: 'creative_link_updated_at' },
  schedule: { response: 'response_updated_at' },
}

const READ_ONLY: Record<string, string[]> = {
  videos: ['Last Upload At'],
  ai_videos: ['Last Upload At'],
  schedule: ['Last Reponse Time'],
  campaigns: ['Launched At'],
}

const byKey = new Map<string, TableMeta>()
const byName = new Map<string, TableMeta>()

for (const table of TABLES) {
  const fields = new Map<string, FieldMapping>(Object.entries(table.fields))
  const primary = [...fields.values()].find((f) => f.kind === 'column')
  const apiOnly = API_ONLY[table.d1Table] ?? {}
  for (const name of Object.keys(apiOnly)) fields.set(name, { kind: 'computed' })
  const meta: TableMeta = {
    name: table.d1Table,
    label: table.airtableName,
    fields,
    primaryColumn: primary?.kind === 'column' ? primary.column : 'id',
    computed: { ...COMPUTED[table.d1Table], ...apiOnly },
    hiddenByDefault: new Set(
      HIDE_REVERSE_LINKS.has(table.d1Table)
        ? [...fields].filter(([, f]) => f.kind === 'inverse').map(([name]) => name)
        : [],
    ),
    touch: TOUCH[table.d1Table] ?? {},
    readOnly: new Set(READ_ONLY[table.d1Table] ?? []),
  }
  byName.set(meta.name, meta)
  // a table can be addressed by its Airtable name, Airtable id or D1 name
  for (const key of [table.airtableName, table.airtableId, table.d1Table]) byKey.set(key, meta)
}

export function getTable(key: string): TableMeta {
  const meta = byKey.get(key)
  if (!meta) throw badRequest(`Unknown table ${key}`)
  return meta
}

export const tableByName = (name: string) => byName.get(name)!
