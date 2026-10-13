// Who may do what. Deny by default: a table or role missing here gets nothing.
// Keys are D1 table names; field names are the Airtable names the dashboard uses.

// Only two roles are in use. A user stored with any other role (Ops,
// Scriptwriter, Media) is `none` and can do nothing until a rule is added here.
export type Role = 'admin' | 'video_editor' | 'service' | 'none'

export interface OwnRule {
  // the column that must hold the caller's user id
  ownColumn: string
  // the only fields they may change
  fields: string[]
}

export interface TableRule {
  read?: boolean
  create?: boolean
  update?: boolean | OwnRule
  delete?: boolean
  // when set, the only fields this role may read
  readFields?: string[]
}

const ROLES = new Set<Role>(['admin', 'video_editor'])

// `Video Editor` (as stored) -> `video_editor`
export function roleSlug(stored: string | null): Role {
  const slug = (stored ?? '').trim().toLowerCase().replace(/\s+/g, '_') as Role
  return ROLES.has(slug) ? slug : 'none'
}

const FULL: TableRule = { read: true, create: true, update: true, delete: true }
const READ: TableRule = { read: true }
const NONE: TableRule = {}
const NAMES_ONLY: TableRule = { read: true, readFields: ['Name', 'Role'] }
const OWN_VIDEOS: TableRule = {
  read: true,
  update: { ownColumn: 'editor_id', fields: ['Status', 'Creative Link', 'Notes', 'Video Data'] },
}

const reference = { video_editor: READ }

// admin is not listed: it gets FULL on everything.
// `service` is the scheduled worker and the image-generation job.
export const PERMISSIONS: Record<string, Partial<Record<Role, TableRule>>> = {
  users: { video_editor: NAMES_ONLY },
  products: { ...reference, service: READ },
  advertorials: reference,
  ad_presets: reference,
  campaign_launch_setup: reference,
  angles: reference,
  images: reference,
  temp_images: { ...reference, service: { read: true, create: true } },
  video_scripts: reference,
  videos: { video_editor: OWN_VIDEOS },
  ai_videos: { video_editor: OWN_VIDEOS },
  campaigns: { video_editor: READ, service: READ },
  schedule: { service: FULL },
  scaling_rules: { service: READ },
  rule_execution_log: { service: { read: true, create: true } },
  master_profile: { service: READ },
  profiles: { service: READ },
}

export const isAdmin = (role: Role) => role === 'admin'

export const ruleFor = (role: Role, table: string): TableRule =>
  isAdmin(role) ? FULL : (PERMISSIONS[table]?.[role] ?? NONE)

// Never returned and never writable through the data routes, for any role.
// Passwords are set through /users. Facebook tokens are used only on the
// server and arrive through the /facebook routes; records show `hasToken` instead.
export const NEVER_FIELDS = new Set(['Password', 'Permanent Token', 'System User Token'])

// Returned only to admin and the service credential
export const SECRET_FIELDS = new Set([
  'Profile FB Password',
  'Profile Email Password',
  'Profile 2FA',
  'Security Email Password',
  'Recovery Code',
  'Recovery Codes',
  'Original Data',
  'Proxy',
  'System User ID',
])

export const canSeeSecrets = (role: Role) => isAdmin(role) || role === 'service'
