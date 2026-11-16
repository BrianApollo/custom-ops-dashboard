import { TABLES } from '@ops/shared'
import { describe, expect, it } from 'vitest'
import { getTable } from '../src/data/registry'

const mapping = (name: string) => TABLES.find((table) => table.airtableName === name)!

describe('D1-only tables', () => {
  it('Script Scores and Media Assets have no Airtable id, so the import skips them', () => {
    for (const name of ['Script Scores', 'Media Assets']) expect(mapping(name).airtableId).toBeUndefined()
  })

  it('the API finds both by Airtable name and D1 name', () => {
    expect(getTable('Script Scores').name).toBe('script_scores')
    expect(getTable('script_scores').label).toBe('Script Scores')
    expect(getTable('Media Assets').name).toBe('media_assets')
    expect(getTable('media_assets').label).toBe('Media Assets')
  })

  it('maps the score fields as agreed', () => {
    const f = getTable('script_scores').fields
    expect(f.get('Video Script')).toEqual({ kind: 'fk', column: 'video_script_id', target: 'video_scripts' })
    expect(f.get('Product')).toEqual({ kind: 'fk', column: 'product_id', target: 'products' })
    expect(f.get('Status')).toMatchObject({ kind: 'column', column: 'status', type: 'text' })
    expect(getTable('script_scores').upsertOn).toEqual({ field: 'Video Script', column: 'video_script_id' })
    expect(f.get('Rank Score')).toMatchObject({ kind: 'column', column: 'rank_score', type: 'real' })
    expect(f.get('Campaigns 30d')).toMatchObject({ kind: 'column', column: 'campaigns_30d', type: 'integer' })
    expect(f.get('Fatigued')).toMatchObject({ kind: 'column', column: 'fatigued', type: 'checkbox' })
  })

  it('maps the asset fields as agreed', () => {
    const f = getTable('media_assets').fields
    expect(getTable('media_assets').primaryColumn).toBe('asset_key')
    expect(getTable('media_assets').upsertOn).toBeNull()
    expect(f.get('Product')).toEqual({ kind: 'fk', column: 'product_id', target: 'products' })
    expect(f.get('Source Video')).toEqual({ kind: 'fk', column: 'source_video_id', target: 'videos' })
    expect(f.get('Used In')).toMatchObject({ kind: 'column', column: 'used_in', type: 'json' })
    expect(f.get('Product Visible')).toMatchObject({ kind: 'column', column: 'product_visible', type: 'checkbox' })
    expect(f.get('Tag Confidence')).toMatchObject({ kind: 'column', column: 'tag_confidence', type: 'real' })
    expect(f.get('Duration Ms')).toMatchObject({ kind: 'column', column: 'duration_ms', type: 'integer' })
    for (const name of ['Hash', 'Phase', 'Kind', 'Rights', 'Storage Key']) {
      expect(f.get(name)).toMatchObject({ kind: 'column', type: 'text', d1Only: true })
    }
  })

  it('Video Scripts carries the five script fields as D1-only text', () => {
    const f = getTable('video_scripts').fields
    const columns = { 'Script Source': 'script_source', 'Donor Ref': 'donor_ref', 'Hook Family': 'hook_family', 'Proof Type': 'proof_type', Structure: 'structure' }
    for (const [name, column] of Object.entries(columns)) {
      expect(f.get(name)).toEqual({ kind: 'column', column, type: 'text', d1Only: true })
    }
  })
})
