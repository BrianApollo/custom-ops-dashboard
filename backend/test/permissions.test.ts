import { describe, expect, it } from 'vitest'
import { canSeeSecrets, NEVER_FIELDS, roleSlug, ruleFor, SECRET_FIELDS } from '../src/permissions'

describe('roleSlug', () => {
  it('maps the stored role strings', () => {
    expect(roleSlug('Admin')).toBe('admin')
    expect(roleSlug('Video Editor')).toBe('video_editor')
    expect(roleSlug('  video   editor ')).toBe('video_editor')
    expect(roleSlug('ADMIN')).toBe('admin')
  })

  it('treats unknown, empty and missing roles as none', () => {
    for (const stored of ['Ops', 'Scriptwriter', 'Media', '', null, 'service', 'none', 'admins']) {
      expect(roleSlug(stored)).toBe('none')
    }
  })
})

describe('ruleFor', () => {
  const FULL = { read: true, create: true, update: true, delete: true }

  it('gives admin full access on every table, including unlisted ones', () => {
    for (const table of ['users', 'videos', 'schedule', 'profiles', 'not_a_table']) {
      expect(ruleFor('admin', table)).toEqual(FULL)
    }
  })

  it('limits video editors', () => {
    expect(ruleFor('video_editor', 'users')).toEqual({ read: true, readFields: ['Name', 'Role'] })
    expect(ruleFor('video_editor', 'products')).toEqual({ read: true })
    expect(ruleFor('video_editor', 'campaigns')).toEqual({ read: true })
    expect(ruleFor('video_editor', 'videos')).toEqual({
      read: true,
      update: { ownColumn: 'editor_id', fields: ['Status', 'Creative Link', 'Notes', 'Video Data'] },
    })
    expect(ruleFor('video_editor', 'ai_videos')).toEqual(ruleFor('video_editor', 'videos'))
    expect(ruleFor('video_editor', 'profiles')).toEqual({})
    expect(ruleFor('video_editor', 'schedule')).toEqual({})
  })

  it('limits the service credential', () => {
    expect(ruleFor('service', 'schedule')).toEqual(FULL)
    expect(ruleFor('service', 'products')).toEqual({ read: true })
    expect(ruleFor('service', 'temp_images')).toEqual({ read: true, create: true })
    expect(ruleFor('service', 'rule_execution_log')).toEqual({ read: true, create: true })
    expect(ruleFor('service', 'users')).toEqual({})
    expect(ruleFor('service', 'videos')).toEqual({})
  })

  it('gives none nothing', () => {
    for (const table of ['users', 'videos', 'products', 'schedule', 'not_a_table']) {
      expect(ruleFor('none', table)).toEqual({})
    }
  })
})

describe('field sets', () => {
  it('NEVER_FIELDS holds passwords and Facebook tokens', () => {
    expect([...NEVER_FIELDS].sort()).toEqual(['Password', 'Permanent Token', 'System User Token'])
  })

  it('SECRET_FIELDS holds the profile credentials', () => {
    expect([...SECRET_FIELDS].sort()).toEqual(
      [
        'Profile FB Password',
        'Profile Email Password',
        'Profile 2FA',
        'Security Email Password',
        'Recovery Code',
        'Recovery Codes',
        'Original Data',
        'Proxy',
        'System User ID',
      ].sort(),
    )
  })

  it('no field is in both sets', () => {
    for (const field of NEVER_FIELDS) expect(SECRET_FIELDS.has(field)).toBe(false)
  })
})

describe('canSeeSecrets', () => {
  it('is true only for admin and service', () => {
    expect(canSeeSecrets('admin')).toBe(true)
    expect(canSeeSecrets('service')).toBe(true)
    expect(canSeeSecrets('video_editor')).toBe(false)
    expect(canSeeSecrets('none')).toBe(false)
  })
})
