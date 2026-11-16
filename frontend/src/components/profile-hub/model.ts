import { text, type ApiRecord } from '../../lib/api'

// The Profile Hub reads a profile in two columns: Received (what the supplier
// delivered, kept as JSON in `Original Data` and locked by the server once
// saved) and Current (the live fields the profile uses today).

// Airtable-style field names the data API uses for a profile
export const F = {
  name: 'Profile Name',
  status: 'Profile Status',
  profileId: 'Profile ID',
  fbUid: 'Profile FB UID',
  uid: 'UID',
  fbEmail: 'Profile Email',
  fbEmailSource: 'FB Email Source',
  fbPassword: 'Profile FB Password',
  twoFa: 'Profile 2FA',
  recoveryCodes: 'Recovery Codes',
  mailboxEmail: 'Mailbox Email',
  mailboxPassword: 'Profile Email Password',
  recoveryEmail: 'Profile Security Email',
  recoveryPassword: 'Security Email Password',
  proxy: 'Proxy',
  notes: 'Extra Notes',
  original: 'Original Data',
  lockedAt: 'Received Locked At',
  setupComplete: 'Setup Complete',
  setupCompletedOn: 'Setup Completed On',
  tokenValid: 'Token Valid',
  tokenEnd: 'Permanent Token End Date',
  hasToken: 'hasToken',
  lastSync: 'Last Sync',
  bms: 'Linked BM',
  pages: 'Linked Pages',
} as const

// what the sidebar needs for every profile
export const LIST_FIELDS = [F.name, F.status, F.profileId, F.fbUid, F.uid, F.fbEmail, F.mailboxEmail, F.setupComplete, F.original, F.fbPassword, F.twoFa, F.mailboxPassword, F.recoveryEmail, F.recoveryPassword]

// keys inside `Original Data`
export type ReceivedKey = 'userId' | 'password' | 'twoFaKey' | 'email' | 'emailPassword' | 'recoveryEmail' | 'recoveryEmailPassword' | 'cookies' | 'proxy'
export type Received = Partial<Record<ReceivedKey, string>>

export function parseOriginal(raw: unknown): Received {
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Received = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) out[key as ReceivedKey] = value
    }
    return out
  } catch {
    return {}
  }
}

export const hasReceived = (record: ApiRecord) => Object.keys(parseOriginal(record.fields[F.original])).length > 0
export const isLocked = (record: ApiRecord) => text(record, F.lockedAt) !== ''

// Which mailbox the Facebook login uses today. The address is also written to
// `Profile Email`, so other pages keep reading a plain field.
export type FbEmailSource = 'received' | 'mailbox' | 'recovery'
export const FB_EMAIL_SOURCES: { value: FbEmailSource; label: string }[] = [
  { value: 'received', label: 'Received' },
  { value: 'mailbox', label: 'Mailbox' },
  { value: 'recovery', label: 'Recovery' },
]
export function resolveFbEmail(source: FbEmailSource, received: Received, current: (field: string) => string) {
  if (source === 'mailbox') return current(F.mailboxEmail)
  if (source === 'recovery') return current(F.recoveryEmail)
  // a profile that arrived before the hub has no received copy; its stored login stands in
  return received.email || current(F.fbEmail)
}
export const fbEmailSource = (record: ApiRecord): FbEmailSource => {
  const stored = text(record, F.fbEmailSource)
  return stored === 'mailbox' || stored === 'recovery' ? stored : 'received'
}

// The credentials that are rotated away from the delivered values, in the
// order the page shows them. Fully rotated = every pair that was delivered differs.
export const ROTATION: { label: string; field: string; received: ReceivedKey }[] = [
  { label: 'Facebook email', field: F.fbEmail, received: 'email' },
  { label: 'Facebook password', field: F.fbPassword, received: 'password' },
  { label: '2FA key', field: F.twoFa, received: 'twoFaKey' },
  { label: 'Email', field: F.mailboxEmail, received: 'email' },
  { label: 'Email password', field: F.mailboxPassword, received: 'emailPassword' },
  { label: 'Recovery email', field: F.recoveryEmail, received: 'recoveryEmail' },
  { label: 'Recovery email password', field: F.recoveryPassword, received: 'recoveryEmailPassword' },
]

export function rotation(record: ApiRecord) {
  const received = parseOriginal(record.fields[F.original])
  const pairs = ROTATION.filter((pair) => received[pair.received])
  const done = pairs.filter((pair) => {
    const current = text(record, pair.field)
    return current !== '' && current !== received[pair.received]
  }).length
  return { done, total: pairs.length }
}

export type State = 'dead' | 'live' | 'unrecorded' | 'received' | 'rotating' | 'rotated'

export const isDead = (record: ApiRecord) => ['Banned', 'Inactive'].includes(text(record, F.status))
export const isLive = (record: ApiRecord) => record.fields[F.setupComplete] === true

export function stateOf(record: ApiRecord): State {
  if (isDead(record)) return 'dead'
  if (isLive(record)) return 'live'
  const { done, total } = rotation(record)
  if (total === 0) return 'unrecorded'
  if (done === 0) return 'received'
  return done < total ? 'rotating' : 'rotated'
}

export const STATUSES = ['Active', 'Inactive', 'Banned']

// No name is invented: sync fills it from Facebook. Until then the email name or the UID stands in.
export const uidOf = (record: ApiRecord) => text(record, F.fbUid) || text(record, F.uid) || text(record, F.profileId)
export const displayName = (record: ApiRecord) => text(record, F.name) || text(record, F.fbEmail).split('@')[0] || uidOf(record) || 'Unnamed profile'
export const hasName = (record: ApiRecord) => text(record, F.name) !== ''

// Confirmed once, in the dialog that marks a profile live
export const FINAL_VERIFICATION = [
  'AdsPower profile opens correctly.',
  'Assigned U.S. proxy is live and showing the expected IP.',
  'Current 2FA generates correctly in AdsPower.',
  'New email and Facebook password are confirmed.',
  '2FA secret and current recovery codes are stored here.',
  'Required Business Managers are accessible.',
  'Required Ad Accounts, Data Sources and Pixels are assigned.',
  'Direct Page access and final Page assignment are confirmed where required.',
  'The record matches the live setup.',
]

// today's date in the browser's zone as YYYY-MM-DD
export function localDate() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function formatDate(value: string, withTime = false) {
  if (!value) return ''
  const time = Date.parse(value)
  if (Number.isNaN(time)) return value
  return new Date(time).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  })
}
