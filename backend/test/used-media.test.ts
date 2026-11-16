import { describe, expect, it } from 'vitest'
import { getTable } from '../src/data/registry'
import { isVideoTable, linkFieldFor, markedUsedFrom, marksUsed, MEDIA_FIELDS, mediaKeyFor } from '../src/lib/usedMedia'

describe('marksUsed', () => {
  it('marks videos and AI videos, never images', () => {
    expect(marksUsed('videoIds')).toBe(true)
    expect(marksUsed('aiVideoIds')).toBe(true)
    expect(marksUsed('imageIds')).toBe(false)
    expect(marksUsed('other')).toBe(false)
  })
})

describe('link fields', () => {
  it('maps each video table to its campaign link field', () => {
    expect(linkFieldFor('videos')).toBe('Videos Used In This Campaign')
    expect(linkFieldFor('ai_videos')).toBe('Videos copy')
    expect(mediaKeyFor('videos')).toBe('videoIds')
    expect(mediaKeyFor('ai_videos')).toBe('aiVideoIds')
  })

  it('names junction fields of campaigns that point at the right table', () => {
    const campaigns = getTable('campaigns')
    const targets = { videoIds: 'videos', aiVideoIds: 'ai_videos', imageIds: 'images' }
    for (const [key, name] of Object.entries(MEDIA_FIELDS)) {
      const field = campaigns.fields.get(name)
      expect(field?.kind).toBe('junction')
      expect(field && 'target' in field ? field.target : null).toBe(targets[key as keyof typeof targets])
    }
  })

  it('knows only the two video tables', () => {
    expect(isVideoTable('videos')).toBe(true)
    expect(isVideoTable('ai_videos')).toBe(true)
    expect(isVideoTable('images')).toBe(false)
    expect(isVideoTable(null)).toBe(false)
  })
})

describe('markedUsedFrom', () => {
  it('shapes the read-back ids by kind', () => {
    expect(markedUsedFrom({ videoIds: ['recA'], aiVideoIds: ['recB'] })).toEqual({ videos: ['recA'], aiVideos: ['recB'] })
  })

  it('gives empty lists for kinds that were not sent', () => {
    expect(markedUsedFrom({})).toEqual({ videos: [], aiVideos: [] })
    expect(markedUsedFrom({ videoIds: [] })).toEqual({ videos: [], aiVideos: [] })
  })
})
