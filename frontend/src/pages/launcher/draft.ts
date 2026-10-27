import { text, type ApiRecord } from '../../lib/api'
import type { AdAccount } from './facebook'

// Whose Facebook token the launcher uses: a profile's own, or a business manager's system user
export type TokenType = 'profile' | 'bm'

// Everything the launcher edits. Saved to the campaign record shortly after each edit.
export interface Draft {
  name: string
  tokenType: TokenType
  profileId: string
  // the business manager whose system user token is used when tokenType is 'bm'
  bmId: string
  adAccountId: string
  pixelId: string
  pageId: string
  redtrackId: string
  redtrackName: string
  // YYYY-MM-DDTHH:MM as typed, '' until chosen. Facebook reads it in the ad account's time zone.
  start: string
  budget: string
  // ISO country codes, as Facebook takes them
  countries: string[]
  callToAction: string
  presetId: string
  // the preset's texts as changed for this campaign; null while they are as the preset stores them
  presetTexts: Record<string, string> | null
  // the URL that took the place of {{link}} in this campaign's copy of the preset texts
  linkVariable: string
  websiteUrl: string
  tracking: string
  displayLink: string
  launchActive: boolean
  reuseCreatives: boolean
  // videos and AI videos together; their record ids never collide
  videoIds: Set<string>
  imageIds: Set<string>
}

// The sets of countries a campaign can target. Each value is the comma-separated
// ISO codes kept on the record; Britain is GB to Facebook and UK to everyone reading.
export const LOCATION_PRESETS = [
  { value: 'US', label: 'US' },
  { value: 'US,CA', label: 'US + Canada' },
  { value: 'US,CA,GB,IE,AU,NZ', label: 'US, CA, UK, IE, AU, NZ' },
  {
    value: 'US,CA,GB,IE,DE,FR,NL,BE,CH,AT,SE,NO,DK,FI,ES,IT,PT,PL,AU,NZ,JP,SG,KR',
    label: 'US, CA, GB, IE, DE, FR, NL, BE, CH, AT, SE, NO, DK, FI, ES, IT, PT, PL, AU, NZ, JP, SG, KR',
  },
]

// The options for a location select and which one is chosen. Countries saved in
// another order still match their preset, and a saved set that is not one of the
// presets is offered as it is, so nothing stored shows as blank.
export function locationChoice(countries: string[]) {
  const same = (value: string) => {
    const codes = value.split(',')
    return codes.length === countries.length && codes.every((code) => countries.includes(code))
  }
  const preset = LOCATION_PRESETS.find((option) => same(option.value))
  if (preset || countries.length === 0) return { options: LOCATION_PRESETS, value: preset?.value ?? '' }
  const value = countries.join(',')
  return { options: [{ value, label: countries.map(countryLabel).join(', ') }, ...LOCATION_PRESETS], value }
}

export const countryLabel = (code: string) => (code === 'GB' ? 'UK' : code)
export const CALLS_TO_ACTION = ['Learn More', 'Shop Now', 'Order Now', 'Get Offer', 'Sign Up']

// `US, ca UK` -> ['US', 'CA', 'GB']
export const countriesFrom = (value: string) => [
  ...new Set(
    value
      .split(/[,\s]+/)
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean)
      .map((code) => (code === 'UK' ? 'GB' : code)),
  ),
]

const linked = (record: ApiRecord, field: string) => (record.fields[field] as string[] | undefined) ?? []

// what the Token Type field holds
const TOKEN_TYPES: Record<TokenType, string> = { profile: 'Profile', bm: 'System User' }

export function draftFrom(campaign: ApiRecord): Draft {
  const date = text(campaign, 'Launch Date')
  const time = text(campaign, 'Launch Time')
  const tokenType = text(campaign, 'Token Type')
  const profileId = text(campaign, 'Profile ID')
  const bmId = text(campaign, 'System User BM ID')
  // every save writes Platform, so a campaign without it has never been through the launcher
  const fresh = !text(campaign, 'Platform')
  return {
    name: text(campaign, 'Name'),
    // a draft from the old system user launcher has a business manager and no token type
    tokenType: tokenType === TOKEN_TYPES.bm || (!tokenType && bmId && !profileId) ? 'bm' : 'profile',
    profileId,
    bmId,
    adAccountId: text(campaign, 'Ad Acc Used'),
    pixelId: text(campaign, 'Pixel Used'),
    pageId: text(campaign, 'Page Used'),
    redtrackId: text(campaign, 'RedTrack Campaign Id'),
    redtrackName: text(campaign, 'RedTrack Campaign Name'),
    // a stored value in another format is left for the user to set again
    start: /^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T${/^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : '00:00'}` : '',
    budget: text(campaign, 'Budget'),
    countries: countriesFrom(text(campaign, 'Location Targeting')),
    callToAction: text(campaign, 'CTA') || CALLS_TO_ACTION[0],
    presetId: linked(campaign, 'Selected Ad Profile')[0] ?? '',
    presetTexts: null,
    linkVariable: text(campaign, 'Link Variable'),
    websiteUrl: text(campaign, 'Website Url'),
    tracking: text(campaign, 'UTMs'),
    displayLink: text(campaign, 'Display Link'),
    launchActive: Boolean(campaign.fields['Launch As Active']),
    // looking in the library first is the default; it stops the same video being uploaded twice
    reuseCreatives: fresh || Boolean(campaign.fields['Reuse Creatives']),
    videoIds: new Set([...linked(campaign, 'Videos Used In This Campaign'), ...linked(campaign, 'Videos copy')]),
    imageIds: new Set(linked(campaign, 'Images Used In This Campaign')),
  }
}

// `profile:rec…` or `bm:rec…` for our API, '' while none is chosen. The token itself never leaves the server.
export function credOf(draft: Pick<Draft, 'tokenType' | 'profileId' | 'bmId'>) {
  if (draft.tokenType === 'bm') return draft.bmId ? `bm:${draft.bmId}` : ''
  return draft.profileId ? `profile:${draft.profileId}` : ''
}

// RedTrack's tracking link as the parameters Facebook appends to every ad's URL:
// the link's path becomes `cmpid`, and its own query string follows unchanged.
//   https://trk.example.com/abc123?sub1={{ad.id}}  ->  cmpid=abc123&sub1={{ad.id}}
// Split as text, because a URL parser would escape the {{…}} macros Facebook fills in.
export function trackingFrom(trackbackUrl: string) {
  const match = /^[a-z]+:\/\/[^/?#]*\/?([^?#]*)(?:\?([^#]*))?/i.exec(trackbackUrl.trim())
  if (!match) return ''
  // the path is used whole, trailing slash included, as the launcher always has
  return [match[1] && `cmpid=${match[1]}`, match[2]].filter(Boolean).join('&')
}

export interface Creative {
  id: string
  name: string
  status: string
  // an AI video lives in its own table and is recorded on the campaign in its own field
  kind: 'video' | 'ai' | 'image'
  // the file Facebook downloads; '' when there is none yet
  url: string
}

export interface Check {
  label: string
  ok: boolean
}

// The placeholder an ad preset's texts carry until the campaign's link is filled in
export const LINK_PLACEHOLDER = '{{link}}'

const TEXT_FIELD = /^(Primary Text|Headline|Description) \d+$/

// The texts the campaign's ads will use, by field name: the draft's own copy once it has one.
// The campaign record keeps only the URL that replaced the placeholder, so after a reload
// the replacement is made again from that URL.
export function presetTexts(draft: Draft, preset: ApiRecord | undefined): Record<string, string> {
  if (draft.presetTexts) return draft.presetTexts
  const link = draft.linkVariable.trim()
  return Object.fromEntries(
    Object.entries(preset?.fields ?? {})
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[0] !== 'Preset Name')
      .map(([name, value]) => [name, link && TEXT_FIELD.test(name) ? value.replaceAll(LINK_PLACEHOLDER, link) : value]),
  )
}

export const linkPending = (draft: Draft, preset: ApiRecord | undefined) =>
  Object.values(presetTexts(draft, preset)).some((value) => value.includes(LINK_PLACEHOLDER))

// The variations of one kind that have something in them, in order: `Primary Text 1` … `Primary Text 5`
export function variations(texts: Record<string, string>, kind: 'Primary Text' | 'Headline' | 'Description') {
  return Object.entries(texts)
    .filter(([name, value]) => name.startsWith(`${kind} `) && TEXT_FIELD.test(name) && value.trim())
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([, value]) => value)
}

export const isWebUrl = (value: string) => /^https?:\/\/[^\s/?#]+\.[^\s]+$/i.test(value.trim())

// `Learn More` -> `LEARN_MORE`, the form Facebook takes
export const facebookCta = (label: string) => label.trim().toUpperCase().replace(/\s+/g, '_')

// Currencies Facebook counts in whole units. The budget is sent in hundredths,
// which would be a hundred times too much for these, so launching in them is refused.
export const WHOLE_UNIT_CURRENCIES = ['CLP', 'COP', 'CRC', 'HUF', 'ISK', 'IDR', 'JPY', 'KRW', 'PYG', 'TWD', 'VND']

// A date and time typed for the ad account's time zone, as Unix seconds. null when either cannot be read.
export function zonedSeconds(local: string, timeZone: string | undefined): number | null {
  if (!timeZone || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null
  const asUtc = new Date(`${local}:00Z`)
  if (Number.isNaN(asUtc.getTime())) return null
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(asUtc)
    const part = (type: string) => Number(parts.find((p) => p.type === type)?.value)
    // how far the zone's clock is from UTC at that moment, daylight saving included
    const offset = Date.UTC(part('year'), part('month') - 1, part('day'), part('hour'), part('minute'), part('second')) - asUtc.getTime()
    return Math.floor((asUtc.getTime() - offset) / 1000)
  } catch {
    // a time zone name the browser does not know
    return null
  }
}

// What must be true before a campaign can launch, grouped as the checklist shows it.
// `account` is the chosen ad account as Facebook lists it for the chosen token.
export function checklist(
  draft: Draft,
  preset: ApiRecord | undefined,
  chosen: Creative[],
  account: AdAccount | undefined,
): { group: string; checks: Check[] }[] {
  const texts = presetTexts(draft, preset)
  const hasTexts = (['Primary Text', 'Headline', 'Description'] as const).every((kind) => variations(texts, kind).length > 0)
  return [
    {
      group: 'Assets',
      checks: [
        { label: 'Ad preset', ok: Boolean(preset) },
        { label: 'Primary text, headline and description', ok: hasTexts },
        { label: `${LINK_PLACEHOLDER} replaced`, ok: Boolean(preset) && !linkPending(draft, preset) },
        { label: 'At least 1 creative', ok: draft.videoIds.size + draft.imageIds.size > 0 },
        // a video still To Do has no file to send
        { label: 'Every creative has a file', ok: chosen.every((item) => item.url !== '' && item.status !== 'To Do') },
      ],
    },
    {
      group: 'Infrastructure',
      checks: [
        { label: 'Facebook token', ok: credOf(draft) !== '' },
        // the account must be one the token can reach; its time zone decides the start time
        { label: 'Ad account', ok: Boolean(account) },
        { label: 'Page', ok: /^\d+$/.test(draft.pageId) },
        { label: 'Pixel', ok: /^\d+$/.test(draft.pixelId) },
      ],
    },
    {
      group: 'Delivery',
      checks: [
        { label: 'Budget', ok: Number(draft.budget) > 0 },
        { label: 'Start date', ok: draft.start !== '' },
        { label: 'Location', ok: draft.countries.length > 0 },
        // an ad with no destination must never go out
        { label: 'Website URL', ok: isWebUrl(draft.websiteUrl) },
      ],
    },
    { group: 'System', checks: [{ label: 'Campaign name', ok: draft.name.trim() !== '' }] },
  ]
}

// The campaign fields a save writes, in the formats the campaign record has always held
export function campaignFields(draft: Draft): Record<string, unknown> {
  const [date, time] = draft.start ? draft.start.split('T') : ['', '']
  const budget = Number(draft.budget)
  return {
    // a name being retyped is not saved while it is empty
    ...(draft.name.trim() ? { Name: draft.name.trim() } : {}),
    Platform: 'Facebook',
    'RedTrack Campaign Id': draft.redtrackId,
    'RedTrack Campaign Name': draft.redtrackName,
    'Selected Ad Profile': draft.presetId ? [draft.presetId] : [],
    'Ad Acc Used': draft.adAccountId,
    'Page Used': draft.pageId,
    'Pixel Used': draft.pixelId,
    'Launch Date': date || null,
    'Launch Time': time || '00:00',
    Budget: draft.budget.trim() && Number.isFinite(budget) ? budget : null,
    'Location Targeting': draft.countries.join(','),
    CTA: draft.callToAction,
    'Website Url': draft.websiteUrl,
    UTMs: draft.tracking,
    'Display Link': draft.displayLink,
    'Link Variable': draft.linkVariable,
    'Profile ID': draft.profileId,
    'System User BM ID': draft.bmId,
    'Token Type': TOKEN_TYPES[draft.tokenType],
    'Reuse Creatives': draft.reuseCreatives,
    'Launch As Active': draft.launchActive,
  }
}

// The chosen media as the campaign's three link fields. Needs the product's media,
// because only it knows which chosen video is an AI video.
export function mediaFields(draft: Draft, creatives: Creative[]): Record<string, string[]> {
  const chosen = (kind: Creative['kind'], ids: Set<string>) => creatives.filter((item) => item.kind === kind && ids.has(item.id)).map((item) => item.id)
  return {
    'Videos Used In This Campaign': chosen('video', draft.videoIds),
    'Videos copy': chosen('ai', draft.videoIds),
    'Images Used In This Campaign': chosen('image', draft.imageIds),
  }
}
