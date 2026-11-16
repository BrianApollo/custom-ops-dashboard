// Turning a supplier's string into parts and guessing which field each part
// belongs to. Suppliers mostly send one pipe-separated line
// (uid | password | 2FA key | email | email password | recovery email | cookies)
// but the order and the separator vary, so parts are recognised by shape and
// the person connects whatever is left by hand.

// the fields of the Add profile form
export type AddKey =
  | 'name'
  | 'uid'
  | 'fbEmail'
  | 'fbPassword'
  | 'twoFa'
  | 'recoveryCodes'
  | 'email'
  | 'emailPassword'
  | 'recoveryEmail'
  | 'recoveryEmailPassword'
  | 'proxy'
  | 'cookies'
  | 'notes'

export interface AddField {
  key: AddKey
  label: string
  required?: boolean
  mono?: boolean
  multiline?: boolean
  placeholder?: string
}

export interface AddGroup {
  name: string
  fields: AddField[]
}

export const ADD_GROUPS: AddGroup[] = [
  {
    name: 'Profile',
    fields: [
      { key: 'name', label: 'Profile Name', placeholder: 'Optional. Shows the email name until Facebook sync fills it' },
      { key: 'uid', label: 'UID', mono: true, placeholder: '15 to 16 digits' },
    ],
  },
  {
    name: 'Facebook',
    fields: [
      { key: 'fbEmail', label: 'Email', required: true },
      { key: 'fbPassword', label: 'Password', required: true, mono: true },
      { key: 'twoFa', label: '2FA Key', mono: true, placeholder: '32-character secret' },
      { key: 'recoveryCodes', label: 'Recovery Codes', mono: true, multiline: true, placeholder: 'Rarely supplied' },
    ],
  },
  {
    name: 'Mailbox',
    fields: [
      { key: 'email', label: 'Email', required: true, placeholder: 'Same as Facebook Email' },
      { key: 'emailPassword', label: 'Password', mono: true },
    ],
  },
  {
    name: 'Recovery mailbox',
    fields: [
      { key: 'recoveryEmail', label: 'Email', placeholder: 'e.g. name@cvlmail.net' },
      { key: 'recoveryEmailPassword', label: 'Password', mono: true },
    ],
  },
  {
    name: 'Other',
    fields: [
      { key: 'proxy', label: 'Proxy', mono: true, placeholder: 'host:port:user:pass' },
      { key: 'cookies', label: 'Cookies', mono: true },
      { key: 'notes', label: 'Notes', multiline: true, placeholder: 'Anything extra' },
    ],
  },
]

export const ADD_FIELDS: Record<AddKey, AddField & { group: string }> = Object.fromEntries(
  ADD_GROUPS.flatMap((group) => group.fields.map((field) => [field.key, { ...field, group: group.name }])),
) as Record<AddKey, AddField & { group: string }>

export const REQUIRED: AddKey[] = ['fbEmail', 'fbPassword', 'email']

export const SHORT: Record<AddKey, string> = {
  name: 'Name',
  uid: 'UID',
  fbEmail: 'FB email',
  fbPassword: 'FB pass',
  twoFa: '2FA',
  recoveryCodes: 'Codes',
  email: 'Mail',
  emailPassword: 'Mail pass',
  recoveryEmail: 'Recovery',
  recoveryEmailPassword: 'Rec pass',
  proxy: 'Proxy',
  cookies: 'Cookies',
  notes: 'Notes',
}

// colour = destination group; a part takes the hue of the group it is connected to
export const GROUP_HUE: Record<string, string> = {
  Profile: '#64748b',
  Facebook: '#1d4ed8',
  Mailbox: '#d97706',
  'Recovery mailbox': '#0d9488',
  Other: '#7c3aed',
}
export const GREY = '#a3a3a3'
export const hueOf = (key: AddKey) => GROUP_HUE[ADD_FIELDS[key].group]

// shape checks
const RECOVERY_DOMAINS = /@(cvlmail\.net|365gmail\.com|365hmail\.com|fviainboxes\.com|rambler\.ru|mail\.ru|gmx\.(com|de)|tutanota\.com|proton\.me)$/i
export const isEmail = (v: string) => /^[^\s@|]+@[^\s@|]+\.[a-z]{2,}$/i.test(v)
export const isUid = (v: string) => /^\d{10,20}$/.test(v)
export const is2fa = (v: string) => {
  const s = v.replace(/\s/g, '')
  return /^[A-Z2-7]{16,}$/i.test(s) && s.length % 4 === 0 && !/^\d+$/.test(s)
}
export const isCookies = (v: string) => /(c_user|datr|xs|sb|fr)=/.test(v)
export const isProxy = (v: string) =>
  /^((\d{1,3}\.){3}\d{1,3}|[a-z0-9.-]+\.[a-z]{2,}):\d{2,5}(:[^:\s|]+:[^:\s|]+)?$/i.test(v) || /^(socks5|http)s?:\/\//i.test(v)
// recovery codes are rarely sent; only clearly separated groups count, so a 32-char 2FA key never lands here
export const isCodes = (v: string) => !is2fa(v) && (/^(\d{8}[\s,;]+){3,}\d{8}$/.test(v.trim()) || /^([A-Z0-9]{4}-[A-Z0-9]{4}[\s,;]*){4,}$/i.test(v.trim()))
const isJunk = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$|^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v) ||
  /^(male|female|m|f|us|uk|usa|vn|ph|id|yes|no|true|false)$/i.test(v) ||
  /^\d{4}$/.test(v) ||
  /^https?:\/\//i.test(v)

// a field only accepts a value of its own shape
export const VALID: Partial<Record<AddKey, (v: string) => boolean>> = {
  fbEmail: isEmail,
  email: isEmail,
  recoveryEmail: isEmail,
  twoFa: is2fa,
  uid: isUid,
  proxy: isProxy,
}
export const BAD_MESSAGE: Partial<Record<AddKey, string>> = {
  fbEmail: 'not an email',
  email: 'not an email',
  recoveryEmail: 'not an email',
  twoFa: 'not a 2FA key',
  uid: 'digits only',
  proxy: 'host:port[:user:pass]',
}
export const fits = (key: AddKey, value: string) => !value || !VALID[key] || VALID[key]!(value)

// "Key: value" lines
const LABELS: [RegExp, AddKey][] = [
  [/^(uid|user ?id|id|fb ?id|profile ?id)$/i, 'uid'],
  [/^(name|profile ?name)$/i, 'name'],
  [/^(pass(word)?|fb ?pass(word)?|facebook ?pass(word)?|login ?pass)$/i, 'fbPassword'],
  [/^(2 ?fa( ?key| ?secret)?|two ?fa|secret|totp|authenticator)$/i, 'twoFa'],
  [/^(recovery ?codes?|backup ?codes?|codes)$/i, 'recoveryCodes'],
  [/^(e-?mail|mail|login ?e-?mail|fb ?e-?mail|facebook ?e-?mail)$/i, 'fbEmail'],
  [/^(mailbox|mailbox ?e-?mail|e-?mail ?2|second ?mail)$/i, 'email'],
  [/^(e-?mail ?pass(word)?|mail ?pass(word)?)$/i, 'emailPassword'],
  [/^(recovery( ?e-?mail)?|backup ?e-?mail|second(ary)? ?e-?mail)$/i, 'recoveryEmail'],
  [/^(recovery ?(e-?mail ?)?pass(word)?|backup ?pass(word)?)$/i, 'recoveryEmailPassword'],
  [/^(proxy|ip|socks5?|http ?proxy)$/i, 'proxy'],
  [/^(cookies?|cookie ?string)$/i, 'cookies'],
  [/^(notes?|comment|extra)$/i, 'notes'],
]
const labelKey = (label: string) => LABELS.find(([re]) => re.test(label.trim()))?.[1]

export type Separator = 'auto' | '|' | 'tab' | ';' | ',' | 'space' | 'lines'
export const SEPARATORS: { value: Separator; label: string }[] = [
  { value: 'auto', label: 'auto' },
  { value: '|', label: '|' },
  { value: 'tab', label: 'tab' },
  { value: ';', label: ';' },
  { value: ',', label: ',' },
  { value: 'space', label: 'space' },
  { value: 'lines', label: 'lines' },
]

export function detectSeparator(line: string): Separator | null {
  const counts: Record<string, number> = {
    '|': (line.match(/\|/g) ?? []).length,
    tab: (line.match(/\t/g) ?? []).length,
    ';': (line.match(/;/g) ?? []).length,
    ',': (line.match(/,/g) ?? []).length,
  }
  // cookies carry ; and = of their own; they must not pick the separator
  if (counts[';'] && /c_user=|datr=/.test(line) && (counts['|'] || counts.tab)) counts[';'] = 0
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  if (n > 0) return best as Separator
  return /\s/.test(line.trim()) ? 'space' : null
}

export function splitLine(line: string, sep: Separator | null): string[] {
  if (!sep || sep === 'auto') return [line]
  if (sep === 'tab') return line.split('\t')
  if (sep === 'space') return line.trim().split(/\s+/)
  if (sep === 'lines') return line.split(/\r?\n/)
  const parts = line.split(sep)
  if (sep !== ';') return parts
  // cookie fragments split by ; are joined back together
  const out: string[] = []
  for (const part of parts) {
    const t = part.trim()
    const last = out[out.length - 1]
    if (last !== undefined && /^[\w.-]+=/.test(t) && /^[\w.-]+=/.test(last.split(';').pop()!.trim())) out[out.length - 1] = `${last};${t}`
    else out.push(t)
  }
  return out
}

export interface Part {
  // position in the line, which saved layouts map by
  index: number
  value: string
  // a "Key: value" label the supplier gave
  labelled?: AddKey
}

// The pasted text as records. Several lines with a separator are several
// profiles; several lines without one are one profile given vertically.
export function readRecords(pasted: string, sep: Separator): string[] {
  const lines = pasted
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return []
  const first = detectSeparator(lines[0])
  if (lines.length > 1 && sep === 'auto' && (!first || first === 'space')) return [lines.join('\n')]
  return lines
}

export function partsOf(record: string, sep: Separator): { parts: Part[]; used: Separator | null } {
  const used = sep === 'auto' ? (record.includes('\n') ? 'lines' : detectSeparator(record)) : sep
  const raw = (used ? splitLine(record, used) : [record]).map((v) => v.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  const parts = raw.map((value, index): Part => {
    const m = /^([A-Za-z0-9 _-]{2,24})\s*[:=]\s*(.+)$/.exec(value)
    if (m && !isCookies(value) && !isProxy(value)) {
      const labelled = labelKey(m[1])
      if (labelled) return { index, value: m[2].trim(), labelled }
    }
    return { index, value }
  })
  return { parts, used }
}

export interface Guess {
  key: AddKey
  sure: boolean
}

// Which field each part looks like. One field per part, one part per field.
export function guessAll(parts: Part[]): Map<number, Guess> {
  const guesses = new Map<number, Guess>()
  const taken = new Set<AddKey>()
  const set = (part: Part, key: AddKey, sure: boolean) => {
    if (guesses.has(part.index) || taken.has(key)) return
    guesses.set(part.index, { key, sure })
    taken.add(key)
  }
  for (const part of parts) if (part.labelled) set(part, part.labelled, true)
  for (const part of parts) {
    if (guesses.has(part.index)) continue
    if (isUid(part.value)) set(part, 'uid', true)
    else if (isCookies(part.value)) set(part, 'cookies', true)
    else if (isProxy(part.value)) set(part, 'proxy', true)
    else if (is2fa(part.value)) set(part, 'twoFa', true)
    else if (isCodes(part.value)) set(part, 'recoveryCodes', true)
  }
  const emails = parts.filter((part) => !guesses.has(part.index) && isEmail(part.value))
  const recovery = emails.filter((part) => RECOVERY_DOMAINS.test(part.value))
  const main = emails.filter((part) => !RECOVERY_DOMAINS.test(part.value))
  if (main[0]) set(main[0], 'fbEmail', true)
  const recoveryList = [...recovery, ...main.slice(1)]
  if (recoveryList[0]) set(recoveryList[0], 'recoveryEmail', recovery.length > 0)
  // a second recovery address has no column: it stays unconnected and goes to Notes

  // password candidates: never an email, uid, 2FA key, proxy or cookie string
  const left = parts.filter(
    (part) =>
      !guesses.has(part.index) &&
      !isJunk(part.value) &&
      !isEmail(part.value) &&
      !isUid(part.value) &&
      !is2fa(part.value) &&
      !isProxy(part.value) &&
      !isCookies(part.value) &&
      part.value.length >= 6 &&
      !/\s/.test(part.value),
  )
  const byIndex = new Map(parts.map((part) => [part.index, part]))
  // the password right after a uid or an email belongs to it
  const after = (key: AddKey, password: AddKey) => {
    const owner = [...guesses].find(([, guess]) => guess.key === key)?.[0]
    if (owner === undefined) return
    const next = byIndex.get(owner + 1)
    if (next && left.includes(next)) set(next, password, false)
  }
  after('uid', 'fbPassword')
  after('fbEmail', 'emailPassword')
  after('recoveryEmail', 'recoveryEmailPassword')
  for (const key of ['fbPassword', 'emailPassword', 'recoveryEmailPassword'] as AddKey[]) {
    if (taken.has(key)) continue
    const candidate = left.find((part) => !guesses.has(part.index))
    if (candidate) set(candidate, key, false)
  }
  return guesses
}

// saved supplier layouts: position in the line -> field
export interface Layout {
  sep: Separator
  map: Record<string, AddKey>
}
const LAYOUT_KEY = 'profilehub.supplierLayouts.v1'
export function loadLayouts(): Record<string, Layout> {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') as Record<string, Layout>
  } catch {
    return {}
  }
}
export function saveLayouts(layouts: Record<string, Layout>) {
  localStorage.setItem(LAYOUT_KEY, JSON.stringify(layouts))
}
