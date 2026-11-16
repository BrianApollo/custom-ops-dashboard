import { describe, expect, it } from 'vitest'
import { fileNameMatchesVideo, storedBaseName } from '../src/lib/uploadName'

describe('storedBaseName', () => {
  it('trims the name and replaces slashes and control characters', () => {
    expect(storedBaseName('  Sample Video 1 - Vertical ')).toBe('Sample Video 1 - Vertical')
    expect(storedBaseName('A/B\\C\u0007D')).toBe('A-B-C-D')
  })

  it('is empty for a missing name', () => {
    expect(storedBaseName(null)).toBe('')
    expect(storedBaseName(undefined)).toBe('')
    expect(storedBaseName('   ')).toBe('')
  })
})

describe('fileNameMatchesVideo', () => {
  it('accepts the record name with any extension', () => {
    expect(fileNameMatchesVideo('Sample Video 1 - Vertical.mp4', 'Sample Video 1 - Vertical')).toBe(true)
    expect(fileNameMatchesVideo('Sample Video 1 - Vertical.mov', ' Sample Video 1 - Vertical ')).toBe(true)
    expect(fileNameMatchesVideo('GhostWing - Script 1039.v2.webm', 'GhostWing - Script 1039.v2')).toBe(true)
  })

  it('accepts a name whose slashes became dashes', () => {
    expect(fileNameMatchesVideo('Hook A-B.mp4', 'Hook A/B')).toBe(true)
  })

  it('refuses another name', () => {
    expect(fileNameMatchesVideo('Someone Else.mp4', 'Sample Video 1')).toBe(false)
    expect(fileNameMatchesVideo('Sample Video 1 extra.mp4', 'Sample Video 1')).toBe(false)
    expect(fileNameMatchesVideo('Sample Video.mp4', 'Sample Video 1')).toBe(false)
  })

  it('refuses a name with an extra part before the extension', () => {
    expect(fileNameMatchesVideo('Sample Video 1.old.mp4', 'Sample Video 1')).toBe(false)
  })

  it('refuses a file name without an extension', () => {
    expect(fileNameMatchesVideo('Sample Video 1', 'Sample Video 1')).toBe(false)
    expect(fileNameMatchesVideo('Sample Video 1.', 'Sample Video 1')).toBe(false)
    expect(fileNameMatchesVideo('.mp4', '')).toBe(false)
  })

  it('refuses when the record has no name', () => {
    expect(fileNameMatchesVideo('.mp4', null)).toBe(false)
    expect(fileNameMatchesVideo('x.mp4', '   ')).toBe(false)
  })

  it('refuses a file name that is not text', () => {
    expect(fileNameMatchesVideo(undefined, 'Sample Video 1')).toBe(false)
    expect(fileNameMatchesVideo(42, 'Sample Video 1')).toBe(false)
  })
})
