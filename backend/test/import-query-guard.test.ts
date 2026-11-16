import { describe, expect, it } from 'vitest'
import { isReadOnlyQuery } from '../src/lib/readOnlySql'

describe('isReadOnlyQuery', () => {
  it('allows a plain SELECT', () => {
    expect(isReadOnlyQuery('SELECT id FROM attachments')).toBe(true)
    expect(isReadOnlyQuery('  select count(*) AS n FROM videos')).toBe(true)
  })

  it('allows WITH ... SELECT', () => {
    expect(isReadOnlyQuery('WITH x AS (SELECT id FROM videos) SELECT * FROM x')).toBe(true)
  })

  it('rejects WITH ... DELETE (a CTE that writes)', () => {
    expect(isReadOnlyQuery('WITH x AS (SELECT id FROM videos) DELETE FROM videos WHERE id IN (SELECT id FROM x)')).toBe(false)
    expect(isReadOnlyQuery('with x as (select 1) delete from videos')).toBe(false)
  })

  it('rejects WITH ... INSERT, UPDATE and REPLACE', () => {
    expect(isReadOnlyQuery('WITH x AS (SELECT 1 AS id) INSERT INTO videos (id) SELECT id FROM x')).toBe(false)
    expect(isReadOnlyQuery("WITH x AS (SELECT 1) UPDATE videos SET status = 'Used'")).toBe(false)
    expect(isReadOnlyQuery('WITH x AS (SELECT 1 AS id) REPLACE INTO videos (id) SELECT id FROM x')).toBe(false)
  })

  it('rejects multiple statements separated by ;', () => {
    expect(isReadOnlyQuery('SELECT 1; DELETE FROM videos')).toBe(false)
    expect(isReadOnlyQuery('SELECT 1;')).toBe(false)
  })

  it('allows exactly PRAGMA optimize', () => {
    expect(isReadOnlyQuery('PRAGMA optimize')).toBe(true)
    expect(isReadOnlyQuery('  PRAGMA optimize  ')).toBe(true)
  })

  it('rejects any other PRAGMA', () => {
    expect(isReadOnlyQuery('PRAGMA foreign_keys = OFF')).toBe(false)
    expect(isReadOnlyQuery('PRAGMA table_info(videos)')).toBe(false)
    expect(isReadOnlyQuery('PRAGMA optimize(0x10002)')).toBe(false)
  })

  it('rejects anything that is not text', () => {
    for (const value of [undefined, null, 42, ['SELECT 1'], { sql: 'SELECT 1' }]) {
      expect(isReadOnlyQuery(value)).toBe(false)
    }
  })

  it('rejects statements that do not start with SELECT or WITH', () => {
    expect(isReadOnlyQuery('DELETE FROM videos')).toBe(false)
    expect(isReadOnlyQuery("UPDATE videos SET status = 'Used'")).toBe(false)
  })

  it('allows a SELECT whose columns look like write words', () => {
    expect(isReadOnlyQuery('SELECT updated_at, created_at, deleted FROM videos')).toBe(true)
    expect(isReadOnlyQuery('WITH x AS (SELECT updated_at, created_at, deleted FROM videos) SELECT * FROM x')).toBe(true)
  })
})
