// Copies the Airtable base into D1 and attachment files into R2.
//
//   npm run import                      export from Airtable, load, verify
//   npm run import -- --from <dir>      reuse a saved export instead of calling Airtable
//   npm run import -- --check-only      export and validate, load nothing
//   npm run import -- --skip-attachments
//
// Airtable stays the source until cutover, so this is safe to run again: rows
// are upserted by id, link tables are replaced whole, and rows that are gone
// from Airtable are deleted from D1. The raw export and the report are written
// to exports/<run>/, which is never committed because it holds credentials.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { TABLES, type FieldMapping, type TableMapping } from '@ops/shared'
import { AwsClient } from 'aws4fetch'
import { env } from './env'

type AirtableRecord = { id: string; createdTime: string; fields: Record<string, unknown> }
type AirtableField = { name: string; type: string }
type AirtableTable = { id: string; name: string; fields: AirtableField[] }
type Junction = Extract<FieldMapping, { kind: 'junction' }>

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(name)
const option = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)

const importTime = new Date().toISOString()
const runDir = option('--from') ?? new URL(`../../exports/${importTime.replace(/[:.]/g, '-')}/`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1')
const inRun = (file: string) => `${runDir.replace(/[\\/]$/, '')}/${file}`

// columns whose values must never appear in the report
const SECRET_COLUMNS = new Set([
  'password',
  'permanent_token',
  'profile_fb_password',
  'profile_email_password',
  'profile_2fa',
  'security_email_password',
  'recovery_code',
  'recovery_codes',
  'original_data',
  'proxy',
  'system_user_token',
  'system_user_id',
])

const problems: string[] = []
const notes: string[] = []
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------------------- Airtable

let lastCall = 0

// Airtable allows 5 requests a second per base; a 429 means wait 30 seconds
async function airtable<T>(path: string): Promise<T> {
  for (;;) {
    await sleep(Math.max(0, lastCall + 220 - Date.now()))
    lastCall = Date.now()
    const response = await fetch(`https://api.airtable.com/v0/${path}`, {
      headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` },
    })
    if (response.status === 429) {
      console.log('  Airtable rate limit; waiting 30 seconds')
      await sleep(30_000)
      continue
    }
    if (!response.ok) throw new Error(`Airtable ${response.status} on ${path}: ${await response.text()}`)
    return (await response.json()) as T
  }
}

async function exportBase() {
  if (!env.AIRTABLE_TOKEN) {
    console.error('AIRTABLE_TOKEN is empty in backend/.env')
    process.exit(1)
  }
  mkdirSync(runDir, { recursive: true })
  const { tables } = await airtable<{ tables: AirtableTable[] }>(`meta/bases/${env.AIRTABLE_BASE_ID}/tables`)
  writeFileSync(inRun('schema.json'), JSON.stringify(tables, null, 2))

  checkSchema(tables)
  if (problems.length) return tables

  for (const table of TABLES) {
    const records: AirtableRecord[] = []
    const found = liveTable(tables, table)
    let offset: string | undefined
    // a table this base does not have is loaded as empty
    while (found) {
      const page = await airtable<{ records: AirtableRecord[]; offset?: string }>(
        `${env.AIRTABLE_BASE_ID}/${found.id}?pageSize=100${offset ? `&offset=${offset}` : ''}`,
      )
      records.push(...page.records)
      offset = page.offset
      if (!offset) break
    }
    writeFileSync(inRun(`${table.d1Table}.json`), JSON.stringify(records))
    console.log(`  exported ${table.airtableName}: ${records.length}`)
  }
  return tables
}

// Airtable field types each kind of mapping may sit on
const TYPES: Record<string, string[]> = {
  text: ['singleLineText', 'multilineText', 'richText', 'email', 'url', 'phoneNumber', 'singleSelect', 'date', 'dateTime', 'lastModifiedTime'],
  integer: ['number', 'currency', 'percent', 'rating', 'duration', 'autoNumber'],
  real: ['number', 'currency', 'percent', 'duration'],
  checkbox: ['checkbox'],
  json: ['multipleSelects'],
  link: ['multipleRecordLinks'],
  attachment: ['multipleAttachments'],
  computed: ['formula', 'rollup', 'count', 'multipleLookupValues', 'button', 'createdTime', 'lastModifiedTime', 'createdBy', 'lastModifiedBy'],
}

const expectedTypes = (field: FieldMapping) =>
  field.kind === 'column'
    ? TYPES[field.type]
    : field.kind === 'attachment' || field.kind === 'computed'
      ? TYPES[field.kind]
      : TYPES.link

// Tables are matched by name: a copy of the base keeps the names but not the ids
const liveTable = (live: AirtableTable[], table: TableMapping) => live.find((t) => t.name === table.airtableName)

// Nothing in Airtable may be dropped without notice: a table or field the map
// does not know, or one whose type changed, stops the import before it writes
// anything. Something the map knows that this base lacks is only noted, and
// stays empty.
function checkSchema(live: AirtableTable[]) {
  const mapped = new Set(TABLES.map((t) => t.airtableName))
  for (const table of live) {
    if (!mapped.has(table.name)) problems.push(`Airtable table "${table.name}" (${table.id}) is not in the field map`)
  }
  for (const table of TABLES) {
    const found = liveTable(live, table)
    if (!found) {
      notes.push(`Table "${table.airtableName}" is not in this base; ${table.d1Table} stays empty`)
      continue
    }
    const liveFields = new Map(found.fields.map((f) => [f.name, f.type]))
    for (const name of liveFields.keys()) {
      if (!table.fields[name]) problems.push(`${table.airtableName}: field "${name}" exists in Airtable but not in the field map`)
    }
    const absent: string[] = []
    for (const [name, field] of Object.entries(table.fields)) {
      if (field.kind === 'column' && field.d1Only) continue
      const type = liveFields.get(name)
      if (!type) absent.push(name)
      else if (!expectedTypes(field).includes(type)) {
        problems.push(`${table.airtableName}: field "${name}" is now type ${type}, which the map does not expect`)
      }
    }
    if (absent.length) notes.push(`${table.airtableName}: not in this base, left empty: ${absent.join(', ')}`)
  }
}

// ---------------------------------------------------------------- transform

interface TableData {
  table: TableMapping
  records: AirtableRecord[]
  // id, stored columns, created_at, updated_at
  baseColumns: string[]
  baseRows: unknown[][]
  fkColumns: string[]
  fkRows: unknown[][]
}

interface AttachmentRow {
  id: string
  table_name: string
  record_id: string
  field_name: string
  position: number
  filename: string
  mime_type: string | null
  size_bytes: number | null
  width: number | null
  height: number | null
  r2_key: string
  created_at: string
  url: string
}

const data = new Map<string, TableData>()
const junctions = new Map<string, { columns: string[]; rows: unknown[][]; fromA: number; fromB: number }>()
const attachments: AttachmentRow[] = []
const fkStats: { column: string; zero: number; one: number; many: number; dangling: number }[] = []
const selectStats: { column: string; counts: Map<string, number> }[] = []
let largest = { where: '', bytes: 0 }

function columnValue(type: string, raw: unknown, where: string): unknown {
  if (type === 'checkbox') return raw === true ? 1 : 0
  // Airtable leaves empty fields out; a missing key is NULL, never the text "undefined"
  if (raw === undefined || raw === null || raw === '') return null
  if (type === 'json') return Array.isArray(raw) && raw.length ? JSON.stringify(raw) : null
  if (type === 'integer' || type === 'real') {
    if (typeof raw !== 'number') problems.push(`${where}: expected a number, got ${typeof raw}`)
    return raw
  }
  if (typeof raw !== 'string') {
    notes.push(`${where}: value is ${typeof raw}, stored as JSON text`)
    return JSON.stringify(raw)
  }
  const bytes = Buffer.byteLength(raw)
  if (bytes > largest.bytes) largest = { where, bytes }
  return raw
}

function transform(live: AirtableTable[]) {
  const ids = new Map<string, Set<string>>()
  const loaded = new Map<string, AirtableRecord[]>()
  for (const table of TABLES) {
    const records = JSON.parse(readFileSync(inRun(`${table.d1Table}.json`), 'utf8')) as AirtableRecord[]
    loaded.set(table.d1Table, records)
    ids.set(table.d1Table, new Set(records.map((r) => r.id)))
  }

  // pairs of each link table as seen from each side: key `a|b` -> position
  const sideA = new Map<string, Map<string, number>>()
  const sideB = new Map<string, Map<string, number>>()
  const junctionOf = new Map<string, Junction>()

  for (const table of TABLES) {
    const records = loaded.get(table.d1Table)!
    const fields = Object.entries(table.fields)
    const columns = fields.flatMap(([name, f]) => (f.kind === 'column' && !f.d1Only ? [{ name, f }] : []))
    const fks = fields.flatMap(([name, f]) => (f.kind === 'fk' ? [{ name, f }] : []))
    const liveTypes = new Map(liveTable(live, table)?.fields.map((f) => [f.name, f.type]))

    const entry: TableData = {
      table,
      records,
      baseColumns: ['id', ...columns.map((c) => c.f.column), 'created_at', 'updated_at'],
      baseRows: [],
      fkColumns: ['id', ...fks.map((c) => c.f.column)],
      fkRows: [],
    }
    data.set(table.d1Table, entry)
    // registered even when the table is empty, so a link table with no pairs left is still emptied
    for (const [, f] of fields) if (f.kind === 'junction') junctionOf.set(`${f.table}:${f.side}`, f)

    const fkCount = new Map(fks.map((c) => [c.name, { column: `${table.d1Table}.${c.f.column}`, zero: 0, one: 0, many: 0, dangling: 0 }]))
    const selects = new Map(
      columns
        .filter((c) => ['singleSelect', 'multipleSelects'].includes(liveTypes.get(c.name) ?? ''))
        .map((c) => [c.name, { column: `${table.d1Table}.${c.f.column}`, counts: new Map<string, number>() }]),
    )

    for (const record of records) {
      const where = (name: string) => `${table.airtableName} ${record.id} "${name}"`
      entry.baseRows.push([
        record.id,
        ...columns.map((c) => columnValue(c.f.type, record.fields[c.name], where(c.name))),
        record.createdTime,
        importTime,
      ])
      for (const [name, stat] of selects) {
        const raw = record.fields[name]
        for (const value of raw === undefined ? ['(empty)'] : Array.isArray(raw) ? raw : [raw]) {
          stat.counts.set(String(value), (stat.counts.get(String(value)) ?? 0) + 1)
        }
      }

      // a link that must hold at most one record
      entry.fkRows.push([
        record.id,
        ...fks.map(({ name, f }) => {
          const linked = (record.fields[name] as string[] | undefined) ?? []
          const stat = fkCount.get(name)!
          if (linked.length === 0) stat.zero++
          else if (linked.length === 1) stat.one++
          else {
            stat.many++
            problems.push(`${where(name)}: holds ${linked.length} records but is stored as a single link`)
          }
          if (linked[0] && !ids.get(f.target)!.has(linked[0])) {
            stat.dangling++
            problems.push(`${where(name)}: links to ${linked[0]}, which is not in ${f.target}`)
          }
          return linked[0] ?? null
        }),
      ])

      for (const [name, f] of fields) {
        if (f.kind === 'junction') {
          const side = f.side === 'a' ? sideA : sideB
          const pairs = side.get(f.table) ?? side.set(f.table, new Map()).get(f.table)!
          ;((record.fields[name] as string[] | undefined) ?? []).forEach((other, position) => {
            if (!ids.get(f.target)!.has(other)) problems.push(`${where(name)}: links to ${other}, which is not in ${f.target}`)
            pairs.set(f.side === 'a' ? `${record.id}|${other}` : `${other}|${record.id}`, position)
          })
        } else if (f.kind === 'attachment') {
          const files = (record.fields[name] as Record<string, unknown>[] | undefined) ?? []
          files.forEach((file, position) => {
            const filename = String(file.filename ?? file.id).replace(/[/\\]/g, '_')
            attachments.push({
              id: file.id as string,
              table_name: table.d1Table,
              record_id: record.id,
              field_name: f.field,
              position,
              filename,
              mime_type: (file.type as string) ?? null,
              size_bytes: (file.size as number) ?? null,
              width: (file.width as number) ?? null,
              height: (file.height as number) ?? null,
              r2_key: `attachments/${file.id}/${filename}`,
              created_at: record.createdTime,
              url: file.url as string,
            })
          })
        }
      }
    }
    fkStats.push(...fkCount.values())
    selectStats.push(...selects.values())
  }

  // each link is built from side A and must be confirmed by side B
  for (const [key, a] of junctionOf) {
    if (!key.endsWith(':a')) continue
    const fromA = sideA.get(a.table) ?? new Map<string, number>()
    const fromB = sideB.get(a.table) ?? new Map<string, number>()
    const otherPosition = `position_in_${a.otherColumn.replace(/_id$/, '')}`
    const rows: unknown[][] = []
    for (const [pair, position] of fromA) {
      const [self, other] = pair.split('|')
      if (!fromB.has(pair)) problems.push(`${a.table}: ${pair} is linked on side A only`)
      rows.push([self, other, position, fromB.get(pair) ?? 0])
    }
    for (const pair of fromB.keys()) {
      if (!fromA.has(pair)) problems.push(`${a.table}: ${pair} is linked on side B only`)
    }
    junctions.set(a.table, {
      columns: [a.selfColumn, a.otherColumn, a.positionColumn, otherPosition],
      rows,
      fromA: fromA.size,
      fromB: fromB.size,
    })
  }
}

// ---------------------------------------------------------------- load

async function api<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${env.IMPORT_API_URL.replace(/\/$/, '')}/api/v1/import/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.SERVICE_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`API ${response.status} on import/${path}: ${await response.text()}`)
  return (await response.json()) as T
}

const query = async (sql: string, params: unknown[] = []) =>
  (await api<{ rows: Record<string, unknown>[] }>('query', { sql, params })).rows

// D1 caps a value at 2 MB, and a statement's rows travel as one JSON value
const MAX_REQUEST_BYTES = 700_000
const MAX_REQUEST_ROWS = 2000

async function send(path: string, table: string, columns: string[], rows: unknown[][]) {
  let chunk: unknown[][] = []
  let bytes = 0
  const flush = async () => {
    if (chunk.length) await api(path, { table, columns, rows: chunk })
    chunk = []
    bytes = 0
  }
  for (const row of rows) {
    const size = Buffer.byteLength(JSON.stringify(row))
    if (chunk.length && (bytes + size > MAX_REQUEST_BYTES || chunk.length >= MAX_REQUEST_ROWS)) await flush()
    chunk.push(row)
    bytes += size
  }
  await flush()
}

const pruned: { table: string; ids: string[] }[] = []
const attachmentResult = { copied: 0, skipped: 0, failed: [] as string[], bytes: 0 }

async function load() {
  // 1. every row, without its links, so that 2. each link has a target
  for (const { table, baseColumns, baseRows } of data.values()) {
    await send('upsert', table.d1Table, baseColumns, baseRows)
    console.log(`  loaded ${table.d1Table}: ${baseRows.length}`)
  }
  for (const { table, records } of data.values()) {
    const { deleted } = await api<{ deleted: string[] }>('prune', { table: table.d1Table, ids: records.map((r) => r.id) })
    if (deleted.length) pruned.push({ table: table.d1Table, ids: deleted })
  }
  for (const { table, fkColumns, fkRows } of data.values()) {
    if (fkColumns.length > 1) await send('update', table.d1Table, fkColumns, fkRows)
  }
  for (const [name, junction] of junctions) {
    await api('replace', { table: name, columns: junction.columns, rows: junction.rows })
    console.log(`  linked ${name}: ${junction.rows.length}`)
  }
  await loadAttachments()
  await api('query', { sql: 'PRAGMA optimize' })
}

// Airtable's file URLs expire within hours, so each file is copied to R2 now.
// A file whose row already exists is not downloaded again.
async function loadAttachments() {
  const have = new Set((await query('SELECT id FROM attachments')).map((row) => row.id))
  const r2 = new AwsClient({ accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' })
  const bucket = `https://${env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET_NAME}`
  const ready: AttachmentRow[] = []

  for (const file of attachments) {
    if (have.has(file.id)) {
      attachmentResult.skipped++
      ready.push(file)
      continue
    }
    if (flag('--skip-attachments')) continue
    try {
      const download = await fetch(file.url)
      if (!download.ok) throw new Error(`download answered ${download.status}`)
      const body = await download.arrayBuffer()
      const key = file.r2_key.split('/').map(encodeURIComponent).join('/')
      const upload = await r2.fetch(`${bucket}/${key}`, {
        method: 'PUT',
        body,
        headers: { 'Content-Type': file.mime_type ?? 'application/octet-stream' },
      })
      if (!upload.ok) throw new Error(`R2 answered ${upload.status}`)
      attachmentResult.copied++
      attachmentResult.bytes += body.byteLength
      ready.push(file)
    } catch (error) {
      attachmentResult.failed.push(`${file.table_name} ${file.record_id} ${file.field_name} ${file.id}: ${(error as Error).message}`)
    }
  }

  const columns = ['id', 'table_name', 'record_id', 'field_name', 'position', 'filename', 'mime_type', 'size_bytes', 'width', 'height', 'r2_key', 'created_at']
  await send('upsert', 'attachments', columns, ready.map((file) => columns.map((c) => file[c as keyof AttachmentRow])))
  if (!flag('--skip-attachments')) {
    const { deleted } = await api<{ deleted: string[] }>('prune', { table: 'attachments', ids: attachments.map((f) => f.id) })
    if (deleted.length) pruned.push({ table: 'attachments', ids: deleted })
  }
  console.log(`  attachments: ${attachmentResult.copied} copied, ${attachmentResult.skipped} already there, ${attachmentResult.failed.length} failed`)
}

// ---------------------------------------------------------------- verify

const show = (column: string, value: unknown) => {
  if (SECRET_COLUMNS.has(column)) return value === null || value === undefined || value === '' ? '[empty]' : '[set]'
  if (value === null || value === undefined) return '(null)'
  const text = String(value).replace(/\s+/g, ' ').replace(/\|/g, '\\|')
  return text.length > 60 ? `${text.slice(0, 57)}...` : text
}

const sameNumber = (a: unknown, b: unknown) =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-9 : (a ?? null) === (b ?? null)

async function computedChecks() {
  const lines: string[] = []
  const compare = (label: string, total: number, mismatches: string[]) =>
    lines.push(
      mismatches.length
        ? `- ${label}: matches on ${total - mismatches.length} of ${total} records. Mismatches: ${mismatches.slice(0, 20).join(', ')}`
        : `- ${label}: matches on ${total} of ${total} records`,
    )

  const scripts = new Map((await query('SELECT * FROM video_scripts_computed')).map((row) => [row.video_script_id, row]))
  const scriptRecords = data.get('video_scripts')!.records
  for (const [field, column] of [['Scripts To Do', 'scripts_to_do'], ['Scripts Past To Do', 'scripts_past_to_do'], ['Calculation', 'calculation']]) {
    compare(
      `Video Scripts.${field}`,
      scriptRecords.length,
      scriptRecords.flatMap((r) => {
        const expected = typeof r.fields[field] === 'number' ? r.fields[field] : field === 'Calculation' ? null : 0
        return sameNumber(expected, scripts.get(r.id)?.[column]) ? [] : [r.id]
      }),
    )
  }
  compare(
    'Video Scripts.Videos',
    scriptRecords.length,
    scriptRecords.flatMap((r) => {
      const expected = [...((r.fields.Videos as string[] | undefined) ?? [])].sort().join()
      const actual = (JSON.parse((scripts.get(r.id)?.video_ids as string) ?? '[]') as string[]).sort().join()
      return expected === actual ? [] : [r.id]
    }),
  )

  // Airtable writes the same rich text two ways: the script's own field escapes
  // Markdown characters (`\_`) and ends with a newline, its lookup does neither.
  // The text is compared with those two differences removed.
  const plain = (value: unknown) =>
    String(value ?? '')
      .replace(/\\([\\`*_{}[\]()#+\-.!>~|])/g, '$1')
      .trim()
  const videos = new Map((await query('SELECT video_id, script_content FROM videos_computed')).map((row) => [row.video_id, row.script_content]))
  const videoRecords = data.get('videos')!.records
  compare(
    'Videos.Script Content (from Script), ignoring Markdown escaping and a trailing newline',
    videoRecords.length,
    videoRecords.flatMap((r) => {
      const expected = (r.fields['Script Content (from Script)'] as string[] | undefined)?.[0]
      return plain(expected) === plain(videos.get(r.id)) ? [] : [r.id]
    }),
  )

  const schedule = new Map((await query('SELECT * FROM schedule_computed')).map((row) => [row.schedule_id, row.campaign_name]))
  const scheduleRecords = data.get('schedule')!.records
  compare(
    'Schedule.Name (from Linked Campaign)',
    scheduleRecords.length,
    scheduleRecords.flatMap((r) => {
      const expected = (r.fields['Name (from Linked Campaign)'] as string[] | undefined)?.[0] ?? null
      return (expected || null) === (schedule.get(r.id) || null) ? [] : [r.id]
    }),
  )
  return lines
}

async function report(loaded: boolean) {
  const out: string[] = [`# Airtable import: verification report`, '', `Run at ${importTime}. Base \`${env.AIRTABLE_BASE_ID}\`. Export in \`${runDir}\`.`, '']
  const section = (title: string, lines: string[]) => out.push(`## ${title}`, '', ...(lines.length ? lines : ['Nothing to report.']), '')

  if (problems.length) {
    section('Stopped: problems found before loading', [
      `Nothing was written to the database. ${problems.length} problem(s):`,
      '',
      ...problems.slice(0, 500).map((p) => `- ${p}`),
    ])
  }
  if (!data.size) {
    writeFileSync(inRun('verification-report.md'), out.join('\n'))
    return
  }

  if (loaded) {
    const counts = ['| Table | Airtable | D1 | Match |', '|---|---|---|---|']
    for (const { table, records } of data.values()) {
      const [{ n }] = await query(`SELECT count(*) AS n FROM ${table.d1Table}`)
      counts.push(`| ${table.d1Table} | ${records.length} | ${n} | ${n === records.length ? 'yes' : 'NO'} |`)
    }
    section('1. Row counts', counts)
  } else {
    section('1. Row counts', ['Not run: nothing was loaded.', '', ...[...data.values()].map(({ table, records }) => `- ${table.d1Table}: ${records.length} in Airtable`)])
  }

  section('2. Single-record links', [
    '| Column | 0 linked | 1 linked | More than 1 | Dangling |',
    '|---|---|---|---|---|',
    ...fkStats.map((s) => `| ${s.column} | ${s.zero} | ${s.one} | ${s.many} | ${s.dangling} |`),
  ])

  const links = ['| Link table | Pairs from side A | Pairs from side B | Rows in D1 |', '|---|---|---|---|']
  for (const [name, junction] of junctions) {
    const inD1 = loaded ? (await query(`SELECT count(*) AS n FROM ${name}`))[0].n : 'not loaded'
    links.push(`| ${name} | ${junction.fromA} | ${junction.fromB} | ${inD1} |`)
  }
  section('3. Link tables', links)

  const byField = new Map<string, number>()
  for (const file of attachments) byField.set(`${file.table_name}.${file.field_name}`, (byField.get(`${file.table_name}.${file.field_name}`) ?? 0) + 1)
  const files = ['| Field | Files in Airtable | Rows in D1 |', '|---|---|---|']
  for (const [field, count] of byField) {
    const [table, name] = field.split('.')
    const inD1 = loaded ? (await query('SELECT count(*) AS n FROM attachments WHERE table_name = ? AND field_name = ?', [table, name]))[0].n : 'not loaded'
    files.push(`| ${field} | ${count} | ${inD1} |`)
  }
  section('4. Attachments', [
    ...files,
    '',
    flag('--skip-attachments') || !loaded
      ? 'File copy not run.'
      : `Copied to R2 this run: ${attachmentResult.copied} files, ${attachmentResult.bytes} bytes. Already there: ${attachmentResult.skipped}. Failed: ${attachmentResult.failed.length}.`,
    ...attachmentResult.failed.map((f) => `- FAILED ${f}`),
  ])

  section('5. Computed fields', [
    ...(loaded ? await computedChecks() : ['Not run: nothing was loaded.']),
    '',
    'Not run (no view built yet): Videos.Identifier, Videos.Author (from Script), Videos.Parent Drive Link, Video Scripts.Editor (from Videos), Schedule.Formula, and the Products count fields.',
  ])

  section(
    '6. Select values',
    selectStats.flatMap((s) => [`- **${s.column}**: ${[...s.counts].sort((a, b) => b[1] - a[1]).map(([value, n]) => `\`${value}\` ${n}`).join(', ')}`]),
  )

  if (loaded) {
    const samples: string[] = []
    for (const { table, records, baseColumns, baseRows, fkColumns, fkRows } of data.values()) {
      const picks = [...records.keys()].sort(() => Math.random() - 0.5).slice(0, 5)
      if (!picks.length) continue
      const rows = await query(`SELECT * FROM ${table.d1Table} WHERE id IN (SELECT value FROM json_each(?))`, [JSON.stringify(picks.map((i) => records[i].id))])
      const byId = new Map(rows.map((row) => [row.id, row]))
      samples.push(`### ${table.d1Table}`, '')
      for (const i of picks) {
        const actual = byId.get(records[i].id)
        const expected: [string, unknown][] = [
          ...baseColumns.map((c, n): [string, unknown] => [c, baseRows[i][n]]),
          ...fkColumns.slice(1).map((c, n): [string, unknown] => [c, fkRows[i][n + 1]]),
        ].filter(([c]) => c !== 'updated_at')
        const wrong = expected.filter(([c, value]) => !actual || !sameNumber(value, actual[c]))
        samples.push(
          `**${records[i].id}**: ${expected.length} columns compared, ${wrong.length ? `${wrong.length} DIFFERENT` : 'all match'}`,
          '',
          '| Column | Airtable | D1 | Match |',
          '|---|---|---|---|',
          ...expected.map(([c, value]) => `| ${c} | ${show(c, value)} | ${show(c, actual?.[c])} | ${wrong.some(([w]) => w === c) ? 'NO' : 'yes'} |`),
          '',
        )
      }
    }
    section('7. Sample records', samples)
  } else {
    section('7. Sample records', ['Not run: nothing was loaded.'])
  }

  const passwords = data.get('users')!
  const passwordIndex = passwords.baseColumns.indexOf('password')
  const plaintext = passwords.baseRows.filter((row) => row[passwordIndex] && !/^[A-Za-z0-9+/]{22}==:[A-Za-z0-9+/]{43}=$/.test(String(row[passwordIndex]))).length
  section('8. Other findings', [
    `- Users whose password is still plain text: ${plaintext} of ${passwords.records.length}.`,
    `- Largest text value: ${largest.bytes} bytes (${largest.where.replace(/ rec\w+/, '')}). D1 allows 2,000,000 per row.`,
    ...(pruned.length ? pruned.map((p) => `- Deleted from ${p.table} because they are gone from Airtable: ${p.ids.join(', ')}`) : ['- No rows were deleted as gone from Airtable.']),
    ...notes.slice(0, 100).map((n) => `- ${n}`),
    '- Not run: a second import to confirm it changes nothing. Run the import again and compare this report.',
    '- Open item: credentials are stored as plain text in D1, as they were in Airtable. Encryption at rest is not in scope.',
  ])

  writeFileSync(inRun('verification-report.md'), out.join('\n'))
}

// ---------------------------------------------------------------- run

console.log(`Run folder: ${runDir}`)
const schema = option('--from') ? (JSON.parse(readFileSync(inRun('schema.json'), 'utf8')) as AirtableTable[]) : await exportBase()
if (option('--from')) checkSchema(schema)

if (!problems.length) transform(schema)

const shouldLoad = !problems.length && !flag('--check-only')
if (shouldLoad) await load()
await report(shouldLoad)

console.log(problems.length ? `Stopped with ${problems.length} problem(s); nothing was loaded.` : shouldLoad ? 'Import finished.' : 'Checked; nothing was loaded.')
console.log(`Report: ${inRun('verification-report.md')}`)
process.exit(problems.length ? 1 : 0)
