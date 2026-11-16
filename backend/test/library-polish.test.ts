import { describe, expect, it } from 'vitest'
import { attachment, downloadName, servableKey } from '../src/lib/assetDownload'
import { productCondition, SHARED_TAG } from '../src/lib/tags'

describe('productCondition', () => {
  it('matches the product itself or an asset shared to it by product name', () => {
    const { sql, params } = productCondition('recAAAAAAAAAAAAAA')
    expect(sql).toContain('t.product_id = ?')
    expect(sql).toContain(`x.tag_key = '${SHARED_TAG}'`)
    expect(sql).toContain('SELECT p.product_name FROM products p WHERE p.id = ?')
    expect(sql.startsWith('(') && sql.endsWith(')')).toBe(true)
    expect(params).toEqual(['recAAAAAAAAAAAAAA', 'recAAAAAAAAAAAAAA'])
    expect(sql.split('?').length - 1).toBe(params.length)
  })
})

describe('servableKey', () => {
  it('allows keys under asset-library/ only', () => {
    expect(servableKey('asset-library/brand/ma_0123456789abcdef.png')).toBe(true)
    expect(servableKey('asset-library/brand/thumbs/ma_1.webp')).toBe(true)
    expect(servableKey('Brand/Videos/a.mp4')).toBe(false)
    expect(servableKey('asset-library/')).toBe(false)
    expect(servableKey('asset-library/../secret')).toBe(false)
    expect(servableKey('asset-library//a.png')).toBe(false)
    expect(servableKey('asset-library/a\\b.png')).toBe(false)
    expect(servableKey(null)).toBe(false)
    expect(servableKey(42)).toBe(false)
  })
})

describe('downloadName', () => {
  it('builds <product>-<kind>-<short id>.<ext>', () => {
    expect(downloadName('Brand™', 'clip', 'ma_0123456789abcdef', 'asset-library/brand/ma_0123456789abcdef.MP4')).toBe('brand-clip-01234567.mp4')
    expect(downloadName('Brand - DE - 1', 'still', 'ma_abc', 'asset-library/x/ma_abc.jpg')).toBe('brand-de-1-still-abc.jpg')
  })

  it('falls back when product, kind or extension is missing', () => {
    expect(downloadName(null, '', 'ma_0123456789', 'asset-library/generic/ma_0123456789')).toBe('generic-asset-01234567')
  })

  it('gives a header value with no quotes inside', () => {
    expect(attachment('a"b.mp4')).toBe('attachment; filename="ab.mp4"')
  })
})
