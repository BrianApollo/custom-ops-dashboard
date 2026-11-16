import { TABLES } from '@ops/shared'
import { describe, expect, it } from 'vitest'
import { getTable } from '../src/data/registry'
import { decodeTags, parseTagFilter, tagConditions, tagsToMap } from '../src/lib/tags'
import { ruleFor } from '../src/permissions'

describe('tagsToMap', () => {
  it('gives a single value for a non-multi tag and a list for a multi tag', () => {
    expect(
      tagsToMap([
        { k: 'shot_type', v: 'close', kind: 'choice', m: 0 },
        { k: 'subjects', v: 'dog', kind: 'choice', m: 1 },
        { k: 'subjects', v: 'person', kind: 'choice', m: 1 },
      ]),
    ).toEqual({ shot_type: 'close', subjects: ['dog', 'person'] })
  })

  it('keeps a multi tag with one value as a list', () => {
    expect(tagsToMap([{ k: 'defects', v: 'none', kind: 'choice', m: 1 }])).toEqual({ defects: ['none'] })
  })

  it('turns flags into booleans and numbers into numbers', () => {
    expect(
      tagsToMap([
        { k: 'has_audio', v: 'true', kind: 'flag', m: 0 },
        { k: 'gen_cost_usd', v: '0.35', kind: 'number', m: 0 },
        { k: 'gen_system', v: 'tool-a', kind: 'text', m: 0 },
      ]),
    ).toEqual({ has_audio: true, gen_cost_usd: 0.35, gen_system: 'tool-a' })
    expect(tagsToMap([{ k: 'has_audio', v: 'false', kind: 'flag', m: 0 }])).toEqual({ has_audio: false })
  })

  it('keeps a tag whose type is not listed, as text, a list only when it holds several values', () => {
    expect(tagsToMap([{ k: 'old', v: 'a', kind: null, m: null }])).toEqual({ old: 'a' })
    expect(tagsToMap([{ k: 'old', v: 'a' }, { k: 'old', v: 'b' }])).toEqual({ old: ['a', 'b'] })
  })

  it('decodes the column: empty or broken input is an empty map', () => {
    expect(decodeTags(null)).toEqual({})
    expect(decodeTags('[]')).toEqual({})
    expect(decodeTags('not json')).toEqual({})
    expect(decodeTags(JSON.stringify([{ k: 'emotion', v: 'calm', kind: 'choice', m: 0 }]))).toEqual({ emotion: 'calm' })
  })
})

describe('parseTagFilter', () => {
  it('takes tag[key]=value out and leaves the other parameters', () => {
    const { tags, rest } = parseTagFilter({ 'tag[shot_type]': 'close', 'where[Phase]': 'solution', limit: '60' })
    expect(tags).toEqual([{ key: 'shot_type', value: 'close' }])
    expect(rest).toEqual({ 'where[Phase]': 'solution', limit: '60' })
  })

  it('accepts a key given more than once; every pair must match', () => {
    const { tags } = parseTagFilter({ 'tag[subjects]': ['dog', 'person', 'dog'], 'tag[emotion]': 'calm' })
    expect(tags).toEqual([
      { key: 'subjects', value: 'dog' },
      { key: 'subjects', value: 'person' },
      { key: 'emotion', value: 'calm' },
    ])
    const where = tagConditions(tags)
    expect(where.sql).toHaveLength(3)
    expect(where.params).toEqual(['subjects', 'dog', 'subjects', 'person', 'emotion', 'calm'])
  })

  it('refuses an empty value and a malformed key', () => {
    expect(() => parseTagFilter({ 'tag[shot_type]': '' })).toThrow(/needs a value/)
    expect(() => parseTagFilter({ 'tag[Shot Type]': 'close' })).toThrow(/Unknown tag/)
    expect(() => parseTagFilter({ 'tag[x;drop]': 'close' })).toThrow(/Unknown tag/)
  })
})

describe('tag tables', () => {
  it('are D1 only, so the import skips them', () => {
    for (const name of ['Tag Types', 'Media Asset Tags']) expect(TABLES.find((t) => t.airtableName === name)!.airtableId).toBeUndefined()
  })

  it('map the vocabulary and tag fields', () => {
    const types = getTable('tag_types')
    expect(types.primaryColumn).toBe('key')
    expect(types.fields.get('Values')).toEqual({ kind: 'column', column: 'allowed_values', type: 'json' })
    expect(types.fields.get('Multi')).toMatchObject({ type: 'checkbox' })
    const tags = getTable('media_asset_tags')
    expect(tags.fields.get('Asset')).toEqual({ kind: 'fk', column: 'asset_id', target: 'media_assets' })
    const assets = getTable('media_assets')
    expect(assets.fields.get('Tag Version')).toMatchObject({ kind: 'column', column: 'tag_version', type: 'integer' })
    expect(assets.fields.get('Generation')).toEqual({ kind: 'column', column: 'generation', type: 'text', d1Only: true })
    expect(assets.fields.get('Parent Asset')).toEqual({ kind: 'fk', column: 'parent_asset_id', target: 'media_assets' })
    expect(assets.computed.tags.shape).toBe('tags')
  })

  it('editors read both tables and write neither; admin has everything', () => {
    for (const table of ['tag_types', 'media_asset_tags']) {
      expect(ruleFor('video_editor', table)).toEqual({ read: true })
      expect(ruleFor('admin', table)).toEqual({ read: true, create: true, update: true, delete: true })
      expect(ruleFor('service', table)).toEqual({})
    }
  })
})
