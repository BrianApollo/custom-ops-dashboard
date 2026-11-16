import { describe, expect, it } from 'vitest'
import { campaignRecordIdFrom, markedUsedOf, markPlan, pickVideoRecord } from '../src/facebook/replaceVideoMark'
import { ApiError } from '../src/lib/errors'

describe('pickVideoRecord', () => {
  it('finds a video or an AI video', () => {
    expect(pickVideoRecord([{ table: 'videos', id: 'recVideo00000001' }])).toEqual({ table: 'videos', id: 'recVideo00000001' })
    expect(pickVideoRecord([{ table: 'ai_videos', id: 'recAiVideo000001' }])).toEqual({ table: 'ai_videos', id: 'recAiVideo000001' })
  })

  it('prefers Videos when both tables match', () => {
    expect(
      pickVideoRecord([
        { table: 'ai_videos', id: 'recAiVideo000001' },
        { table: 'videos', id: 'recVideo00000001' },
      ]),
    ).toEqual({ table: 'videos', id: 'recVideo00000001' })
  })

  it('is null when no record holds the file', () => {
    expect(pickVideoRecord([])).toBeNull()
    expect(pickVideoRecord([{ table: 'images', id: 'recImage00000001' }])).toBeNull()
    expect(pickVideoRecord([{ table: 'videos', id: null }])).toBeNull()
  })
})

describe('campaignRecordIdFrom', () => {
  it('is undefined when none is sent', () => {
    expect(campaignRecordIdFrom(undefined)).toBeUndefined()
    expect(campaignRecordIdFrom(null)).toBeUndefined()
    expect(campaignRecordIdFrom('')).toBeUndefined()
  })

  it('keeps a record id', () => {
    expect(campaignRecordIdFrom('recAbcdefghijklmn')).toBe('recAbcdefghijklmn')
  })

  it('refuses anything else with a 422', () => {
    for (const value of ['abc', 'rec123', 42, {}, ['recAbcdefghijklmn']]) {
      expect(() => campaignRecordIdFrom(value)).toThrow(ApiError)
    }
  })
})

describe('markPlan', () => {
  it('marks and links a video in Videos Used In This Campaign', () => {
    expect(markPlan({ table: 'videos', id: 'recV' }, 'recC')).toEqual({
      table: 'videos',
      id: 'recV',
      campaignRecordId: 'recC',
      linkField: 'Videos Used In This Campaign',
    })
  })

  it('links an AI video in Videos copy', () => {
    expect(markPlan({ table: 'ai_videos', id: 'recA' }, 'recC')?.linkField).toBe('Videos copy')
  })

  it('still marks a video when no campaign was found, without a link', () => {
    expect(markPlan({ table: 'videos', id: 'recV' }, null)).toEqual({ table: 'videos', id: 'recV', campaignRecordId: null, linkField: null })
    expect(markPlan({ table: 'videos', id: 'recV' }, undefined)?.campaignRecordId).toBeNull()
  })

  it('writes nothing when no dashboard record holds the file', () => {
    expect(markPlan(null, 'recC')).toBeNull()
    expect(markPlan(null, null)).toBeNull()
  })
})

describe('markedUsedOf', () => {
  it('reads the stored result', () => {
    const result = { adId: '1', creativeId: '2', markedUsed: { table: 'videos', id: 'recV', campaignRecordId: 'recC', status: 'Used' } }
    expect(markedUsedOf(result)).toEqual({ table: 'videos', id: 'recV', campaignRecordId: 'recC', status: 'Used' })
  })

  it('keeps a missing campaign and a status that is not Used', () => {
    const result = { markedUsed: { table: 'ai_videos', id: 'recA', campaignRecordId: null, status: null } }
    expect(markedUsedOf(result)).toEqual({ table: 'ai_videos', id: 'recA', campaignRecordId: null, status: null })
  })

  it('is null for jobs finished before the field existed, and for no record', () => {
    expect(markedUsedOf({ adId: '1', creativeId: '2' })).toBeNull()
    expect(markedUsedOf({ adId: '1', markedUsed: null })).toBeNull()
    expect(markedUsedOf({})).toBeNull()
    expect(markedUsedOf(null)).toBeNull()
    expect(markedUsedOf({ markedUsed: { table: 'images', id: 'x' } })).toBeNull()
  })
})
