import type { ApiRecord } from '../../lib/api'

// The credentials a profile arrives with, kept as JSON in `Original Data` so
// they survive the rotation in stages 3 to 6
export interface OriginalKey {
  key: string
  label: string
  secret?: boolean
  multiline?: boolean
  hint?: string
}

export const ORIGINAL_KEYS: OriginalKey[] = [
  { key: 'userId', label: 'User ID' },
  { key: 'password', label: 'Password', secret: true },
  { key: 'twoFaKey', label: '2FA key', secret: true },
  { key: 'email', label: 'Email' },
  { key: 'emailPassword', label: 'Email password', secret: true },
  { key: 'recoveryEmail', label: 'Recovery email', hint: 'Goes to cvlmail.net' },
  { key: 'cookies', label: 'Cookies', secret: true, multiline: true },
]

export function parseOriginal(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export const originalValue = (original: Record<string, unknown>, key: string) => {
  const value = original[key]
  return typeof value === 'string' ? value : ''
}

export interface FieldSpec {
  field: string
  label: string
  kind?: 'secret' | 'secret-multiline'
  hint?: string
  // the delivered value this stage is meant to replace
  replaces?: string
}

export interface Stage {
  number: number
  doneField: string
  title: string
  timing: string
  summary: string
  fields: FieldSpec[]
  // read-only list of linked records shown in the box
  links?: 'Linked BM' | 'Linked Pages'
  screenshot?: { field: string; hint: string }
  steps: string[]
}

export const STAGES: Stage[] = [
  {
    number: 1,
    doneField: 'SOP 1 AdsPower Setup',
    title: 'Add profile to AdsPower',
    timing: 'Day 0',
    summary: 'Profile, proxy and 2FA verified in AdsPower before any other work.',
    fields: [
      { field: 'Profile ID', label: 'Profile ID' },
      { field: 'Proxy', label: 'Proxy', kind: 'secret' },
      { field: 'Profile 2FA', label: '2FA secret', kind: 'secret' },
      { field: 'Linked AdsProfile', label: 'AdsPower user ID', hint: 'The user_id of this profile in AdsPower.' },
    ],
    steps: [
      'Add the profile to AdsPower.',
      'Add the assigned U.S. proxy.',
      'Add the existing 2FA secret/code setup.',
      'Open the profile and confirm the displayed IP is U.S.-based and matches the expected proxy.',
      'Confirm AdsPower displays a live 2FA code with a countdown timer.',
      'Record/update all profile, proxy and authentication details here.',
    ],
  },
  {
    number: 2,
    doneField: 'SOP 2 Initial Activity',
    title: 'Initial profile activity',
    timing: 'Days 1-14',
    summary: 'Light, normal activity every day while the profile settles.',
    fields: [],
    steps: [
      'For approximately the first two weeks, log in and click around the profile each day.',
      'After the initial period, activity can normally be reduced to once every 2-3 days.',
      'Record relevant status/notes.',
    ],
  },
  {
    number: 3,
    doneField: 'SOP 3 New Email',
    title: 'Create replacement email',
    timing: 'Day 7+',
    summary: 'A new mailbox that will become the Facebook login email.',
    fields: [
      { field: 'Profile Email', label: 'Email' },
      { field: 'Profile Email Password', label: 'Email password', kind: 'secret' },
      { field: 'Profile Security Email', label: 'Backup email' },
      { field: 'Security Email Password', label: 'Backup email password', kind: 'secret' },
    ],
    steps: [
      'Create a new Hotmail, Mail.com, Proton Mail, or other suitable mailbox.',
      'Set the company backup email as the mailbox recovery/backup email.',
      'Store the new mailbox login and recovery details here.',
      'Wait roughly 1-2 days before changing the Facebook login email.',
    ],
  },
  {
    number: 4,
    doneField: 'SOP 4 Facebook Email',
    title: 'Change Facebook login email',
    timing: '+1-2 days',
    summary: 'Point the Facebook profile at the new mailbox.',
    fields: [{ field: 'Profile Email', label: 'Facebook email', replaces: 'email' }],
    steps: [
      'Update the Facebook login email to the new mailbox.',
      'Confirm the new email is working correctly.',
      'Update the record immediately.',
      'Wait a few days before the next credential change.',
    ],
  },
  {
    number: 5,
    doneField: 'SOP 5 Password',
    title: 'Change Facebook password',
    timing: '+a few days',
    summary: 'Rotate the password separately from the email change.',
    fields: [{ field: 'Profile FB Password', label: 'Facebook password', kind: 'secret', replaces: 'password' }],
    steps: [
      'Change the Facebook password.',
      'Verify the new password works.',
      'Update the record immediately.',
      'Wait a few days before changing 2FA.',
    ],
  },
  {
    number: 6,
    doneField: 'SOP 6 2FA & Recovery',
    title: 'Replace 2FA and recovery codes',
    timing: '+a few days',
    summary: 'New authenticator secret here and in AdsPower, fresh recovery codes stored.',
    fields: [
      { field: 'Profile 2FA', label: '2FA secret', kind: 'secret', replaces: 'twoFaKey' },
      { field: 'Recovery Codes', label: 'Recovery codes', kind: 'secret-multiline' },
    ],
    steps: [
      'Change the Facebook 2FA setup.',
      'Capture the long authenticator secret string (typically around 16 characters).',
      'Store the secret string here.',
      'Add the same secret to AdsPower.',
      'Confirm AdsPower generates the new 2FA codes correctly.',
      'Regenerate/download new Facebook recovery or backup codes.',
      'Store the new recovery codes here.',
    ],
  },
  {
    number: 7,
    doneField: 'SOP 7 BM Access',
    title: 'Accept Business Manager access',
    timing: 'Around week 2+',
    summary: 'Add the profile to the required existing Business Managers.',
    fields: [],
    links: 'Linked BM',
    screenshot: { field: 'SOP 7 Screenshot', hint: 'Proof of BM access' },
    steps: [
      'Send/share the required Business Manager invitations to the new profile.',
      'Open the invitation email from the new profile and accept it.',
      'Enter the profile name where required.',
      'Do not opt into unnecessary marketing/promotional emails.',
      'Confirm access and update the record.',
      'Wait roughly 1-3 days before assigning the full asset set.',
    ],
  },
  {
    number: 8,
    doneField: 'SOP 8 Assets Assigned',
    title: 'Assign business assets',
    timing: '+1-3 days',
    summary: 'Ad Accounts, Data Sources and Pixels assigned in one controlled pass.',
    fields: [],
    screenshot: { field: 'SOP 8 Screenshot', hint: 'Proof of assigned assets' },
    steps: [
      'Select the profile/person inside the Business Manager settings.',
      'Choose Assign Assets.',
      'Assign all required Ad Accounts, Data Sources, and Pixels.',
      'Check that the intended permissions/access levels are enabled.',
      'Update the record.',
    ],
  },
  {
    number: 9,
    doneField: 'SOP 9 Page Access',
    title: 'Complete Page admin access',
    timing: 'Final stage',
    summary: 'Page admin access accepted, then Pages assigned to the profile.',
    fields: [],
    links: 'Linked Pages',
    screenshot: { field: 'SOP 9 Screenshot', hint: 'Proof of Page access' },
    steps: [
      'From an existing Page admin profile, invite/share Page access with the new profile.',
      'Open the invitation from the new profile and accept it.',
      'Accept the required permissions.',
      'Confirm the new profile now has the intended Page access.',
      'Return to the business asset assignment area and assign the relevant Pages to the profile.',
      'Update the record.',
    ],
  },
]

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

export const TOTAL_BOXES = STAGES.length + 1

// what the picker needs to show a profile and its progress
export const LIST_FIELDS = ['Profile Name', 'Profile Email', 'Profile ID', 'Profile Status', 'Setup Complete', 'Original Data', ...STAGES.map((s) => s.doneField)]

export function receivedComplete(record: ApiRecord) {
  const original = parseOriginal(record.fields['Original Data'])
  return ORIGINAL_KEYS.every(({ key }) => originalValue(original, key).trim() !== '')
}

// Box 1 counts once every delivered value is filled in; each stage counts once ticked
export const boxesDone = (record: ApiRecord) =>
  STAGES.filter((stage) => record.fields[stage.doneField] === true).length + (receivedComplete(record) ? 1 : 0)

export const isLive = (record: ApiRecord) => record.fields['Setup Complete'] === true

export interface SupplierLine {
  values: Record<string, string>
  // anything after the cookies column
  extras: string[]
  warnings: string[]
}

const looksLikeEmail = (value: string) => /^[^\s@|]+@[^\s@|]+\.[^\s@|]+$/.test(value)

// Suppliers hand a profile over as one line:
// uid | password | 2FA key | email | email password | recovery email | cookies [| extra…]
export function parseSupplierLine(pasted: string): SupplierLine | null {
  const lines = pasted.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  if (lines.length === 0) return null
  const columns = lines[0].split('|').map((column) => column.trim())
  while (columns.length > 0 && columns[columns.length - 1] === '') columns.pop()
  if (columns.length < 7) return null

  const [userId, password, twoFaKey, email, emailPassword, recoveryEmail, cookies, ...extras] = columns
  const warnings: string[] = []
  if (lines.length > 1) warnings.push(`${lines.length} lines pasted; only the first is used.`)
  if (!/^\d{6,}$/.test(userId)) warnings.push('User ID is not a number of six or more digits.')
  if (!/^[A-Z2-7]{16,}$/i.test(twoFaKey)) warnings.push('2FA key does not look like an authenticator secret.')
  if (!looksLikeEmail(email)) warnings.push('Email does not look like an email address.')
  if (!looksLikeEmail(recoveryEmail)) warnings.push('Recovery email does not look like an email address.')
  if (!cookies.includes('=')) warnings.push('The cookies column does not look like cookies.')
  if (cookies.includes('c_user=') && !cookies.includes(`c_user=${userId}`)) warnings.push('The c_user cookie does not match the User ID.')

  return { values: { userId, password, twoFaKey, email, emailPassword, recoveryEmail, cookies }, extras: extras.filter(Boolean), warnings }
}

// today's date in the browser's zone as YYYY-MM-DD
export function localDate() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
