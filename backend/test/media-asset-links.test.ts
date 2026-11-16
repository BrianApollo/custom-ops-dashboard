import { describe, expect, it } from 'vitest'
import { getTable } from '../src/data/registry'
import { linkFor, linkOrNull, urlPath } from '../src/lib/fileLink'

describe('linkFor', () => {
  it('joins the base and key, with or without a trailing slash on the base', () => {
    expect(linkFor('https://files.example.test', 'asset-library/brand/ma_1.mp4')).toBe('https://files.example.test/asset-library/brand/ma_1.mp4')
    expect(linkFor('https://files.example.test/', 'asset-library/brand/thumbs/ma_1.webp')).toBe(
      'https://files.example.test/asset-library/brand/thumbs/ma_1.webp',
    )
  })

  it('keeps spaces and escapes only % # ?, like every stored video link', () => {
    expect(urlPath('A b/c%20d#e?f.mp4')).toBe('A b/c%2520d%23e%3Ff.mp4')
    expect(linkFor('https://files.example.test', 'Brand - 1/Videos/Brand - Script 1.mp4')).toBe(
      'https://files.example.test/Brand - 1/Videos/Brand - Script 1.mp4',
    )
  })
})

describe('linkOrNull', () => {
  it('is null for a missing or empty key', () => {
    for (const key of [null, undefined, '', '   ', 5]) expect(linkOrNull('https://files.example.test', key)).toBeNull()
  })

  it('is null when no public base is configured', () => {
    expect(linkOrNull(undefined, 'asset-library/brand/ma_1.mp4')).toBeNull()
    expect(linkOrNull('', 'asset-library/brand/ma_1.mp4')).toBeNull()
  })

  it('builds the address when both are present', () => {
    expect(linkOrNull('https://files.example.test', 'asset-library/brand/ma_1.png')).toBe('https://files.example.test/asset-library/brand/ma_1.png')
  })
})

describe('media_assets file fields', () => {
  it('maps File Key and Thumbnail Key as D1-only text', () => {
    const f = getTable('media_assets').fields
    expect(f.get('File Key')).toEqual({ kind: 'column', column: 'file_key', type: 'text', d1Only: true })
    expect(f.get('Thumbnail Key')).toEqual({ kind: 'column', column: 'thumbnail_key', type: 'text', d1Only: true })
  })

  it('returns fileUrl and thumbnailUrl as API-only links built from those keys', () => {
    const meta = getTable('media_assets')
    expect(meta.fields.get('fileUrl')).toEqual({ kind: 'computed' })
    expect(meta.fields.get('thumbnailUrl')).toEqual({ kind: 'computed' })
    expect(meta.computed.fileUrl).toEqual({ sql: 't.file_key', shape: 'link' })
    expect(meta.computed.thumbnailUrl).toEqual({ sql: 't.thumbnail_key', shape: 'link' })
  })
})
