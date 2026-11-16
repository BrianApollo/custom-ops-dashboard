import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-ignore plain .mjs script without types
import * as copy from '../scripts/local-copy-data.mjs'
// @ts-ignore plain .mjs script without types
import { localConfig, localDir, localTemplate, wranglerAt, wranglerDir } from '../scripts/local-lib.mjs'

type Row = Record<string, unknown>
type Db = { prepare: (sql: string) => { all: (...p: unknown[]) => Row[]; run: (...p: unknown[]) => unknown }; exec: (sql: string) => void }

// A fake source: an in-memory SQLite built from the migrations, answering the
// same POST body the D1 REST endpoint receives.
function fakeSource(db: Db, { fail = [] as number[] } = {}) {
  const calls: { sql: string; params: unknown[] }[] = []
  let n = 0
  const fetch = async (_url: string, init: { body: string }) => {
    const { sql, params } = JSON.parse(init.body)
    n++
    if (fail.includes(n)) return new Response(JSON.stringify({ success: false, errors: [{ code: 971, message: 'Please wait and consider throttling your request speed: rate limit exceeded' }] }), { status: 429 })
    calls.push({ sql, params })
    const results = db.prepare(sql).all(...params).map((r) => ({ ...r }))
    return new Response(JSON.stringify({ success: true, errors: [], result: [{ results, success: true }] }), { status: 200 })
  }
  return { source: { accountId: 'acc', databaseId: 'db', token: 'fake', fetch, sleep: async () => {} }, calls }
}

const now = '2026-01-01T00:00:00.000Z'

function fillSource(db: Db) {
  for (let i = 1; i <= 5; i++) {
    db.prepare('INSERT INTO users (id, name, email, password, role, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)').run(
      `recUser${i}`, `Editor ${i}`, `editor${i}@example.test`, `fake-password-${i}`, i === 1 ? 'Admin' : 'Video Editor', now, now)
    db.prepare(
      'INSERT INTO profiles (id, profile_name, permanent_token, token_valid, profile_fb_password, profile_email_password, security_email_password, profile_2fa, recovery_code, recovery_codes, proxy, original_data, sop_5_password, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
    ).run(`recProfile${i}`, `Profile ${i}`, `fake-token-${i}`, 'fb-pw', 'mail-pw', 'sec-pw', '2fa-seed', 'rc', 'rcs', 'proxy:1', '{"x":1}', now, now)
    db.prepare('INSERT INTO videos (id, video_name, editor_id, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      `recVideo${i}`, `Video ${i} it's`, `recUser${i}`, 'Available', 'line one\nline two', now, now)
  }
  db.prepare('INSERT INTO business_managers (id, bm_name, system_user_id, system_user_token, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'recBm1', 'BM 1', 'su-1', 'fake-su-token', now, now)
}

describe('SELECT-only guard', () => {
  it('allows a plain SELECT', () => {
    expect(copy.assertSelectOnly('SELECT 1')).toBe('SELECT 1')
  })
  it('rejects everything else', () => {
    for (const sql of ['DELETE FROM users', 'select 1', ' SELECT 1', 'SELECT 1; DROP TABLE users', 'WITH x AS (SELECT 1) SELECT * FROM x', 'PRAGMA table_info(users)', 'INSERT INTO users SELECT 1', 'UPDATE users SET a=1', '', null]) {
      expect(() => copy.assertSelectOnly(sql)).toThrow()
    }
  })
  it('every request goes through the guard', async () => {
    let sent = 0
    const source = { accountId: 'a', databaseId: 'b', token: 't', fetch: async () => { sent++; return new Response('{}') } }
    await expect(copy.sourceQuery(source, 'DELETE FROM users')).rejects.toThrow(/non-SELECT/)
    expect(sent).toBe(0)
  })
})

describe('scrub list', () => {
  it('covers tokens, passwords and every SECRET_FIELDS column', async () => {
    const { schema } = await copy.schemaFromMigrations()
    const list: Map<string, string> = copy.scrubList(schema)
    console.log(`Blanked columns (${list.size}):\n${[...list].map(([k, v]) => `  ${k}  <- ${v}`).join('\n')}`)
    const { copy: tables, skipped } = copy.tableSelection(schema, null)
    console.log(`Tables copied (${tables.length}): ${tables.join(', ')}\nTables skipped (${skipped.length}): ${skipped.join(', ')}`)
    for (const key of [
      'profiles.permanent_token',
      'business_managers.system_user_token',
      'users.password',
      'profiles.profile_fb_password',
      'profiles.profile_email_password',
      'profiles.profile_2fa',
      'profiles.security_email_password',
      'profiles.recovery_code',
      'profiles.recovery_codes',
      'profiles.original_data',
      'profiles.proxy',
      'business_managers.system_user_id',
    ]) expect(list.has(key), key).toBe(true)
    for (const kept of copy.NAME_RULE_EXCEPTIONS) expect(list.has(kept)).toBe(false)
    for (const t of ['sessions', 'audit_log', 'idempotency_keys', 'rate_limits', 'jobs']) expect(skipped).toContain(t)
    expect(tables).toContain('profiles')
  })

  it('fails loudly when a secret field cannot be mapped', async () => {
    const { schema } = await copy.schemaFromMigrations()
    schema.get('profiles').columns = schema.get('profiles').columns.filter((c: { name: string }) => c.name !== 'proxy')
    expect(() => copy.scrubList(schema)).toThrow(/Proxy/)
  })

  it('selects NULL for blanked columns', async () => {
    const { schema } = await copy.schemaFromMigrations()
    const sql = copy.buildPageSql('users', schema.get('users').columns, copy.scrubList(schema))
    expect(sql).toMatch(/NULL AS "password"/)
    expect(sql).toMatch(/ORDER BY "id" LIMIT \? OFFSET \?$/)
  })
})

describe('paging', () => {
  it('copies all rows in order over 3 pages and retries a 429', async () => {
    const { schema, db } = await copy.schemaFromMigrations()
    fillSource(db)
    const { source, calls } = fakeSource(db, { fail: [2] })
    const got: Row[] = []
    const total = await copy.fetchTable(source, 'videos', schema.get('videos').columns, copy.scrubList(schema), (rows: Row[]) => got.push(...rows), { pageSize: 2, pause: 0 })
    expect(total).toBe(5)
    expect(got.map((r) => r.id)).toEqual(['recVideo1', 'recVideo2', 'recVideo3', 'recVideo4', 'recVideo5'])
    expect(calls.map((c) => c.params)).toEqual([[2, 0], [2, 2], [2, 4]])
  })

  it('halves the page size on a size error', async () => {
    const { schema, db } = await copy.schemaFromMigrations()
    fillSource(db)
    const sizes: number[] = []
    const fetch = async (_u: string, init: { body: string }) => {
      const { sql, params } = JSON.parse(init.body)
      sizes.push(params[0])
      if (params[0] > 100) return new Response('response too large', { status: 500 })
      return new Response(JSON.stringify({ success: true, result: [{ results: db.prepare(sql).all(...params) }] }))
    }
    const total = await copy.fetchTable({ accountId: 'a', databaseId: 'b', token: 't', fetch, sleep: async () => {} }, 'videos', schema.get('videos').columns, copy.scrubList(schema), () => {}, { pause: 0 })
    expect(total).toBe(5)
    expect(sizes).toEqual([500, 250, 125, 62])
  })
})

describe('end to end against a throwaway local state', () => {
  const persistTo = join(wranglerDir, `test-copy-${randomBytes(4).toString('hex')}`)
  let wroteConfig = false
  const q = (sql: string) => JSON.parse(wranglerAt(persistTo, ['d1', 'execute', 'DB', '--json', '--command', sql], { capture: true }))[0].results

  beforeAll(() => {
    if (!existsSync(localConfig)) {
      mkdirSync(localDir, { recursive: true })
      writeFileSync(localConfig, readFileSync(localTemplate, 'utf8'))
      wroteConfig = true
    }
    wranglerAt(persistTo, ['d1', 'migrations', 'apply', 'DB'], { capture: true })
  }, 120_000)

  afterAll(() => {
    rmSync(persistTo, { recursive: true, force: true })
    if (wroteConfig) rmSync(localConfig, { force: true })
  })

  it('copies rows, blanks credentials, deactivates users, and is idempotent', async () => {
    const { db } = await copy.schemaFromMigrations()
    fillSource(db)
    const { source, calls } = fakeSource(db)
    q(`INSERT INTO products (id, product_name, created_at, updated_at) VALUES ('recStale', 'stale', '${now}', '${now}')`)

    for (let run = 0; run < 2; run++) {
      const result = await copy.runCopy({ source, persistTo, log: () => {} })
      expect(result.verification.ok).toBe(true)
    }
    for (const call of calls) expect(call.sql).toMatch(/^SELECT\b/)

    expect(q('SELECT count(*) AS n FROM products')[0].n).toBe(0)
    const users = q('SELECT id, name, password, active FROM users ORDER BY id')
    expect(users.map((u: Row) => u.name)).toEqual(['Editor 1', 'Editor 2', 'Editor 3', 'Editor 4', 'Editor 5'])
    for (const u of users) {
      expect(u.password).toBeNull()
      expect(u.active).toBe(0)
    }
    const profiles = q('SELECT * FROM profiles ORDER BY id')
    expect(profiles).toHaveLength(5)
    for (const p of profiles) {
      for (const col of ['permanent_token', 'profile_fb_password', 'profile_email_password', 'security_email_password', 'profile_2fa', 'recovery_code', 'recovery_codes', 'proxy', 'original_data']) {
        expect(p[col], col).toBeNull()
      }
      expect(p.profile_name).toMatch(/^Profile \d$/)
      expect(p.token_valid).toBe(1)
      expect(p.sop_5_password).toBe(1)
    }
    const videos = q('SELECT id, video_name, editor_id, notes FROM videos ORDER BY id')
    expect(videos).toHaveLength(5)
    expect(videos[0]).toEqual({ id: 'recVideo1', video_name: "Video 1 it's", editor_id: 'recUser1', notes: 'line one\nline two' })
    expect(q('SELECT system_user_id, system_user_token, bm_name FROM business_managers')).toEqual([{ system_user_id: null, system_user_token: null, bm_name: 'BM 1' }])
    // the seed only runs against the default local state; it is not part of this test
    expect(q("SELECT count(*) AS n FROM users WHERE id LIKE 'recLocal%'")[0].n).toBe(0)
  }, 180_000)
})

describe('insertSql statement size', () => {
  it('cuts statements by size and fills an oversized row in pieces', async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE t (id text PRIMARY KEY, body text, n integer)')
    const big = `it's ${'x'.repeat(500)}'end`
    const rows = [
      { id: 'a', body: 'small', n: 1 },
      { id: 'b', body: big, n: 2 },
      { id: 'c', body: { nested: 'y'.repeat(300) }, n: 3 },
    ]
    const sql = copy.insertSql('t', ['id', 'body', 'n'], rows, { pk: ['id'], maxChars: 200, longChars: 64 })
    for (const statement of sql.split(';\n').filter(Boolean)) expect(statement.length).toBeLessThanOrEqual(200)
    db.exec(sql)
    const got = db.prepare('SELECT id, body, n FROM t ORDER BY id').all() as Row[]
    expect(got).toEqual([
      { id: 'a', body: 'small', n: 1 },
      { id: 'b', body: big, n: 2 },
      { id: 'c', body: JSON.stringify({ nested: 'y'.repeat(300) }), n: 3 },
    ])
  })

  it('refuses an oversized row in a table without a primary key', () => {
    expect(() => copy.insertSql('t', ['body'], [{ body: 'z'.repeat(500) }], { maxChars: 100, longChars: 50 })).toThrow(/too large/)
  })
})
