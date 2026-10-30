import { Activity, Building2, CreditCard, Flag, User, type LucideIcon } from 'lucide-react'
import { useMemo } from 'react'
import { useRecords } from '../../data'
import { text, type ApiRecord } from '../../lib/api'
import { searchWords } from '../../lib/search'

export type Kind = 'profile' | 'bm' | 'adAccount' | 'page' | 'pixel'
export type Tone = 'green' | 'amber' | 'red' | 'blue' | 'neutral'

interface KindMeta {
  table: string
  label: string
  plural: string
  nameField: string
  // the field holding Facebook's own id
  idField: string
  syncedField: string
  icon: LucideIcon
  // Only what the page shows is asked for. Passwords, 2FA secrets and proxies
  // are left out on purpose, so they never reach this page at all.
  fields: string
}

export const KINDS: Record<Kind, KindMeta> = {
  profile: {
    table: 'profiles',
    label: 'Profile',
    plural: 'Profiles',
    nameField: 'Profile Name',
    idField: 'Profile ID',
    syncedField: 'Last Sync',
    icon: User,
    fields:
      'Profile ID,Profile Name,Profile Status,Permanent Token End Date,Token Valid,Last Sync,Hidden,Profile Email,Profile Link,Profile Review Date,Linked BM,Linked Pages,hasToken',
  },
  bm: {
    table: 'business_managers',
    label: 'Business Manager',
    plural: 'Business Managers',
    nameField: 'BM Name',
    idField: 'BM ID',
    syncedField: 'Last Synced',
    icon: Building2,
    fields:
      'BM ID,BM Name,BM Status,Verification Status,Last Synced,System User ID,System User Created,Hidden,Linked Profile,Linked Ad Accs,Linked Pixels,Owned Pixels,Ad Accounts,hasToken',
  },
  adAccount: {
    table: 'ad_accounts',
    label: 'Ad Account',
    plural: 'Ad Accounts',
    nameField: 'Ad Acc Name',
    idField: 'Ad Acc ID',
    syncedField: 'Last Synced',
    icon: CreditCard,
    fields: 'Ad Acc ID,Ad Acc Name,Ad Acc Status,Disable Reason,Currency,Account Type,Timezone,Amount Spent,Last Synced,Hidden,Owner BM,Linked BM',
  },
  page: {
    table: 'pages',
    label: 'Page',
    plural: 'Pages',
    nameField: 'Page Name',
    idField: 'Page ID',
    syncedField: 'Last Synced',
    icon: Flag,
    fields: 'Page ID,Page Name,Published,Page Link,Verification Status,Fan Count,Last Synced,Hidden,Linked Profiles',
  },
  pixel: {
    table: 'pixels',
    label: 'Pixel',
    plural: 'Pixels',
    nameField: 'Pixel Name',
    idField: 'Pixel ID',
    syncedField: 'Last Synced',
    icon: Activity,
    fields: 'Pixel ID,Pixel Name,Available,Last Fired Time,Creation Time,Last Synced,Hidden,Owner BM,Linked BMs',
  },
}

// Which fields link one kind to another. Both the many-to-many link and the
// owner link count, so nothing owned is missing from its business manager.
const LINKS: Record<Kind, Partial<Record<Kind, string[]>>> = {
  profile: { bm: ['Linked BM'], page: ['Linked Pages'] },
  bm: { profile: ['Linked Profile'], adAccount: ['Linked Ad Accs', 'Ad Accounts'], pixel: ['Linked Pixels', 'Owned Pixels'] },
  adAccount: { bm: ['Owner BM', 'Linked BM'] },
  page: { profile: ['Linked Profiles'] },
  pixel: { bm: ['Owner BM', 'Linked BMs'] },
}

export interface Item {
  kind: Kind
  id: string
  key: string
  record: ApiRecord
  name: string
  fbId: string
  status: string
  hidden: boolean
  // what the search box is matched against
  haystack: string
}

export interface Data {
  profiles: Item[]
  bms: Item[]
  adAccounts: Item[]
  pages: Item[]
  pixels: Item[]
  byKey: Map<string, Item>
  // the Master Profile row, and the profile it points at
  masterRecordId?: string
  masterProfileId?: string
}

export const itemKey = (kind: Kind, id: string) => `${kind}:${id}`

// PENDING_RISK_REVIEW -> Pending risk review
const pretty = (status: string) =>
  /_/.test(status) || (status.length > 3 && status === status.toUpperCase())
    ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase().replace(/_/g, ' ')
    : status

function statusOf(kind: Kind, record: ApiRecord) {
  if (kind === 'profile') return text(record, 'Profile Status')
  if (kind === 'bm') return pretty(text(record, 'BM Status'))
  if (kind === 'adAccount') return pretty(text(record, 'Ad Acc Status'))
  if (kind === 'page') return text(record, 'Published')
  const available = text(record, 'Available')
  return available === 'Yes' ? 'Available' : available ? 'Unavailable' : ''
}

// Statuses are free text. Bad ones are tested first: `inactive` contains `active`.
export function statusTone(status: string): Tone {
  const lower = status.toLowerCase()
  if (/inactive|disabled|closed|banned|restricted|unpublished|unavailable/.test(lower)) return 'red'
  if (/pending|unsettled|grace/.test(lower)) return 'amber'
  if (lower.includes('active') || ['published', 'available', 'verified'].includes(lower)) return 'green'
  return 'neutral'
}

function toItems(kind: Kind, records: ApiRecord[]): Item[] {
  const meta = KINDS[kind]
  return records
    .map((record) => {
      const name = text(record, meta.nameField) || 'Unnamed'
      const fbId = text(record, meta.idField)
      const status = statusOf(kind, record)
      return {
        kind,
        id: record.id,
        key: itemKey(kind, record.id),
        record,
        name,
        fbId,
        status,
        hidden: record.fields.Hidden === true,
        haystack: `${name} ${fbId} ${status}`.toLowerCase(),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Everything the page shows, loaded whole: the lists are a few hundred rows at most
export function useInfrastructure() {
  const profiles = useRecords(KINDS.profile.table, { fields: KINDS.profile.fields })
  const bms = useRecords(KINDS.bm.table, { fields: KINDS.bm.fields })
  const adAccounts = useRecords(KINDS.adAccount.table, { fields: KINDS.adAccount.fields })
  const pages = useRecords(KINDS.page.table, { fields: KINDS.page.fields })
  const pixels = useRecords(KINDS.pixel.table, { fields: KINDS.pixel.fields })
  // the server uses the oldest row, which is the first one in the default order
  const master = useRecords('master_profile', { fields: 'Name,Profile Record' })
  const sources = [profiles, bms, adAccounts, pages, pixels, master]

  const data = useMemo<Data | undefined>(() => {
    if (!profiles.records || !bms.records || !adAccounts.records || !pages.records || !pixels.records || !master.records) return undefined
    const lists = {
      profiles: toItems('profile', profiles.records),
      bms: toItems('bm', bms.records),
      adAccounts: toItems('adAccount', adAccounts.records),
      pages: toItems('page', pages.records),
      pixels: toItems('pixel', pixels.records),
    }
    const masterRecord = master.records[0]
    return {
      ...lists,
      byKey: new Map(Object.values(lists).flatMap((items) => items.map((item) => [item.key, item] as const))),
      masterRecordId: masterRecord?.id,
      masterProfileId: (masterRecord?.fields['Profile Record'] as string[] | undefined)?.[0],
    }
  }, [profiles.records, bms.records, adAccounts.records, pages.records, pixels.records, master.records])

  return {
    data,
    error: sources.find((source) => source.error)?.error,
    loading: sources.some((source) => source.loading),
    reload: () => sources.forEach((source) => source.reload()),
  }
}

// the records of `kind` linked to `item`, by name
export function linked(data: Data, item: Item, kind: Kind): Item[] {
  const ids = new Set<string>()
  for (const field of LINKS[item.kind][kind] ?? []) {
    for (const id of (item.record.fields[field] as string[] | undefined) ?? []) ids.add(id)
  }
  return [...ids].flatMap((id) => data.byKey.get(itemKey(kind, id)) ?? []).sort((a, b) => a.name.localeCompare(b.name))
}

// the kinds an item of each kind links to, in the order the details panel lists them
export const RELATED: Record<Kind, Kind[]> = {
  profile: ['bm', 'page'],
  bm: ['profile', 'adAccount', 'pixel'],
  adAccount: ['bm'],
  page: ['profile'],
  pixel: ['bm'],
}

export interface BmNode {
  item: Item
  adAccounts: Item[]
  pixels: Item[]
}

export interface ProfileNode {
  item: Item
  bms: BmNode[]
  pages: Item[]
}

export interface Tree {
  profiles: ProfileNode[]
  // records no profile or business manager leads to
  unlinked: { bms: BmNode[]; adAccounts: Item[]; pixels: Item[]; pages: Item[] }
  empty: boolean
}

// Profiles, their business managers and pages, and each business manager's ad
// accounts and pixels. A search keeps a record that matches along with
// everything under it, and the path down to any match further in. Whatever
// sits under a hidden record is hidden with it.
export function buildTree(data: Data, search: string, showHidden: boolean): Tree {
  const words = searchWords(search)
  const shown = (item: Item) => showHidden || !item.hidden
  const hit = (item: Item) => words.every((word) => item.haystack.includes(word))
  // `all`: something above matched, so the whole list stays
  const leaves = (items: Item[], all: boolean) => items.filter((item) => shown(item) && (all || hit(item)))

  const bmNodes = (bms: Item[], all: boolean) =>
    bms.filter(shown).flatMap((bm) => {
      const own = all || hit(bm)
      const node: BmNode = { item: bm, adAccounts: leaves(linked(data, bm, 'adAccount'), own), pixels: leaves(linked(data, bm, 'pixel'), own) }
      return own || node.adAccounts.length || node.pixels.length ? [node] : []
    })

  const profiles = data.profiles.filter(shown).flatMap((profile) => {
    const own = hit(profile)
    const node: ProfileNode = { item: profile, bms: bmNodes(linked(data, profile, 'bm'), own), pages: leaves(linked(data, profile, 'page'), own) }
    return own || node.bms.length || node.pages.length ? [node] : []
  })

  const alone = (items: Item[], parent: Kind) => items.filter((item) => linked(data, item, parent).length === 0)
  const unlinked = {
    bms: bmNodes(alone(data.bms, 'profile'), false),
    adAccounts: leaves(alone(data.adAccounts, 'bm'), false),
    pixels: leaves(alone(data.pixels, 'bm'), false),
    pages: leaves(alone(data.pages, 'profile'), false),
  }
  const empty = profiles.length + unlinked.bms.length + unlinked.adAccounts.length + unlinked.pixels.length + unlinked.pages.length === 0
  return { profiles, unlinked, empty }
}

const DAY_MS = 86_400_000

// whole days from today (UTC, as the server writes the date) to a YYYY-MM-DD date
export function daysUntil(date: string) {
  const end = Date.parse(`${date.slice(0, 10)}T00:00:00Z`)
  const today = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(end) ? undefined : Math.round((end - today) / DAY_MS)
}

// What is known about a profile's stored token. The token itself never reaches the browser.
export function tokenState(record: ApiRecord): { label: string; tone: Tone; detail: string } {
  if (!record.fields.hasToken) return { label: 'No token', tone: 'neutral', detail: 'No Facebook token is stored.' }
  const end = text(record, 'Permanent Token End Date').slice(0, 10)
  const days = end ? daysUntil(end) : undefined
  if (days !== undefined && days < 0) {
    return { label: `Token expired ${-days}d ago`, tone: 'red', detail: `A token is stored, but it expired on ${end}.` }
  }
  const expiry = days === undefined ? 'Its expiry date is not known.' : `It expires on ${end} (${days} ${days === 1 ? 'day' : 'days'} left).`
  if (record.fields['Token Valid'] !== true) {
    return {
      label: 'Token not confirmed',
      tone: 'amber',
      detail: `A token is stored, but Facebook has not confirmed it, or rejected it at the last check. ${expiry}`,
    }
  }
  if (days === undefined) return { label: 'Token stored', tone: 'green', detail: `A token is stored. ${expiry}` }
  return { label: `Token: ${days}d left`, tone: days <= 7 ? 'red' : days <= 14 ? 'amber' : 'green', detail: `A token is stored. ${expiry}` }
}

export function badgesFor(data: Data, item: Item) {
  const badges: { label: string; tone: Tone }[] = []
  if (item.kind === 'profile' && data.masterProfileId === item.id) badges.push({ label: 'Master', tone: 'blue' })
  if (item.status) badges.push({ label: item.status, tone: statusTone(item.status) })
  if (item.kind === 'profile') {
    const token = tokenState(item.record)
    badges.push({ label: token.label, tone: token.tone })
  }
  if (item.kind === 'bm') {
    badges.push(item.record.fields.hasToken ? { label: 'System user token', tone: 'green' } : { label: 'No system user token', tone: 'amber' })
  }
  if (item.hidden) badges.push({ label: 'Hidden', tone: 'neutral' })
  return badges
}

// a stored time for reading; a bare date is shown as it is
export function when(value: string) {
  if (!value || /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const time = Date.parse(value)
  return Number.isNaN(time) ? value : new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
