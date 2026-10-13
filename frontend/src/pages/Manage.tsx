import { ChartLine, Check, Clock, Copy, ListPlus, Minus, Plus, RefreshCw, Search, ShieldCheck, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useState } from 'react'
import { useAuth } from '../auth'
import { AddAdsDialog } from '../components/campaign-view/AddAdsDialog'
import { DataTable, type Column } from '../components/DataTable'
import { LinkRedtrackDialog } from '../components/manage/LinkRedtrackDialog'
import { button, Select, StatusBadge, Tip } from '../components/ui'
import { useFetch, useRecords } from '../data'
import { api, text, type ApiRecord } from '../lib/api'
import { profileCred, withCred } from '../lib/facebook'
import { ScheduleDialog } from './Schedules'

// Facebook's own names for the date ranges it reports on
const RANGES = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last_3d', label: 'Last 3 days' },
  { value: 'last_7d', label: 'Last 7 days' },
  { value: 'last_14d', label: 'Last 14 days' },
  { value: 'last_30d', label: 'Last 30 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'maximum', label: 'All time' },
]
const STATUSES = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'all', label: 'All statuses' },
]
// the Select cannot hold an empty value, so these stand for "no choice"
const MASTER = 'master'
const ALL = 'all'

// As Facebook sends them: money in cents as text, one insights row for the chosen range
interface Campaign {
  id: string
  name: string
  status: string
  daily_budget?: string
  lifetime_budget?: string
  // e.g. 2026-09-23T10:00:00+0000
  created_time?: string
  insights?: { data?: { spend?: string }[] }
  adAccountId: string
  adAccountName: string
}

interface Overview {
  adAccounts: { id: string; name: string }[]
  campaigns: Campaign[]
  // ad accounts Facebook would not let this profile read
  failedAdAccounts: string[]
}

// One day of a campaign in RedTrack's report. Purchases are RedTrack's `total_conversions`.
interface ReportRow {
  date?: string
  cost?: number
  total_revenue?: number
  total_conversions?: number
  clicks?: number
  lp_clicks?: number
  // cost per conversion, revenue per conversion, revenue per click
  cpa?: number
  aov?: number
  epc?: number
  // shares between 0 and 1: landing-page click-through and conversion rate
  lp_ctr?: number
  cr?: number
}

// RedTrack answers with the rows, or wraps them in `items` when totals are asked for
type Report = ReportRow[] | { items?: ReportRow[] }
const reportRows = (report: Report | undefined) => (Array.isArray(report) ? report : (report?.items ?? []))

// revenue per dollar of cost, and profit as a share of cost; undefined when nothing was spent
const roasOf = (row: ReportRow) => (row.cost ? (row.total_revenue ?? 0) / row.cost : undefined)
const roiOf = (row: ReportRow) => (row.cost ? ((row.total_revenue ?? 0) - row.cost) / row.cost : undefined)
const ratio = (value: number | undefined) => (value === undefined ? '—' : value.toFixed(2))
const percent = (value: number | undefined) => (value === undefined ? '—' : `${(value * 100).toFixed(2)}%`)

// a date in the browser's zone as YYYY-MM-DD, `days` from today
function day(days = 0, from = new Date()) {
  const date = new Date(from)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// The dates a Facebook range covers, for asking RedTrack about the same period.
// Facebook's "last N days" are the N full days before today.
function datesOf(range: string): { date_from: string; date_to: string } {
  const now = new Date()
  const lastDays = /^last_(\d+)d$/.exec(range)
  if (lastDays) return { date_from: day(-Number(lastDays[1])), date_to: day(-1) }
  if (range === 'today') return { date_from: day(), date_to: day() }
  if (range === 'yesterday') return { date_from: day(-1), date_to: day(-1) }
  if (range === 'this_month') return { date_from: day(0, new Date(now.getFullYear(), now.getMonth(), 1)), date_to: day() }
  if (range === 'last_month') {
    return { date_from: day(0, new Date(now.getFullYear(), now.getMonth() - 1, 1)), date_to: day(0, new Date(now.getFullYear(), now.getMonth(), 0)) }
  }
  // all time: further back than any campaign here
  return { date_from: '2020-01-01', date_to: day() }
}

// the date ranges POST /manage/roas accepts by name
const ROAS_PRESETS = ['today', 'yesterday', 'last_3d', 'last_7d', 'last_30d']

// The expanded row always covers this many days back from today, whatever range the page shows
const DETAIL_DAYS = 30

interface Review {
  campaignId: string
  campaignName: string | null
  ads: { id: string; name: string; effective_status: string }[]
}

const dollars = (amount: number) => amount.toLocaleString(undefined, { style: 'currency', currency: 'USD' })
const title = (status: string) => status.charAt(0) + status.slice(1).toLowerCase().replaceAll('_', ' ')
const spend = (campaign: Campaign) => Number(campaign.insights?.data?.[0]?.spend ?? 0)

function budget(campaign: { daily_budget?: string; lifetime_budget?: string }) {
  if (Number(campaign.daily_budget)) return `${dollars(Number(campaign.daily_budget) / 100)} / day`
  if (Number(campaign.lifetime_budget)) return `${dollars(Number(campaign.lifetime_budget) / 100)} lifetime`
  // the budget is then set on the ad sets
  return <span className="text-neutral-400">On ad sets</span>
}

const number = (value: number | undefined) => <span className="tabular-nums">{(value ?? 0).toLocaleString()}</span>
const money = (value: number | undefined, digits = 2) => (
  <span className="tabular-nums">${(value ?? 0).toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })}</span>
)
const share = (value: number | undefined) => <span className="tabular-nums">{((value ?? 0) * 100).toFixed(2)}%</span>

const DAY_COLUMNS: Column<ReportRow>[] = [
  { header: 'Date', cell: (row) => <span className="tabular-nums">{row.date}</span> },
  { header: 'Cost', align: 'right', cell: (row) => money(row.cost) },
  { header: 'Purchases', align: 'right', cell: (row) => number(row.total_conversions) },
  { header: 'Revenue', align: 'right', cell: (row) => money(row.total_revenue) },
  { header: 'ROAS', align: 'right', cell: (row) => <span className="tabular-nums">{ratio(roasOf(row))}</span> },
  {
    header: 'ROI',
    align: 'right',
    cell: (row) => <span className={`tabular-nums ${(roiOf(row) ?? 0) < 0 ? 'text-red-700' : ''}`}>{percent(roiOf(row))}</span>,
  },
]

const MORE_DAY_COLUMNS: Column<ReportRow>[] = [
  { header: 'CPA', align: 'right', cell: (row) => money(row.cpa) },
  { header: 'AOV', align: 'right', cell: (row) => money(row.aov) },
  { header: 'EPC', align: 'right', cell: (row) => money(row.epc, 4) },
  { header: 'Clicks', align: 'right', cell: (row) => number(row.clicks) },
  { header: 'LP clicks', align: 'right', cell: (row) => number(row.lp_clicks) },
  { header: 'LP CTR', align: 'right', cell: (row) => share(row.lp_ctr) },
  { header: 'CR', align: 'right', cell: (row) => share(row.cr) },
]

// A campaign's RedTrack numbers for the last 30 days: the totals, then one row per day
function CampaignDetail({ redtrackId }: { redtrackId: string }) {
  const [more, setMore] = useState(false)
  const report = useFetch<Report>(
    `/redtrack/report?${new URLSearchParams({
      group: 'date',
      campaign_id: redtrackId,
      date_from: day(-DETAIL_DAYS),
      date_to: day(),
      fields: 'date,cost,total_revenue,total_conversions,clicks,lp_clicks,cpa,aov,epc,lp_ctr,cr',
    })}`,
  )

  if (report.error) return <p className="text-sm text-red-700">Could not load RedTrack numbers: {report.error.message}</p>
  if (!report.data) return <p className="text-sm text-neutral-500">Loading from RedTrack…</p>

  // newest day first
  const days = reportRows(report.data).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  const total: ReportRow = {
    cost: days.reduce((sum, row) => sum + (row.cost ?? 0), 0),
    total_revenue: days.reduce((sum, row) => sum + (row.total_revenue ?? 0), 0),
    total_conversions: days.reduce((sum, row) => sum + (row.total_conversions ?? 0), 0),
  }
  const cards = [
    { label: 'Total cost', value: dollars(total.cost ?? 0) },
    { label: 'Purchases', value: (total.total_conversions ?? 0).toLocaleString() },
    { label: 'Revenue', value: dollars(total.total_revenue ?? 0) },
    { label: 'ROAS', value: ratio(roasOf(total)) },
    { label: 'ROI', value: percent(roiOf(total)), negative: (roiOf(total) ?? 0) < 0 },
  ]

  return (
    <>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
            <dt className="text-xs text-neutral-500">{card.label}</dt>
            <dd className={`mt-1 text-lg font-semibold tabular-nums ${card.negative ? 'text-red-700' : ''}`}>{card.value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 flex justify-end">
        <button onClick={() => setMore(!more)} aria-pressed={more} className={`${button.secondary} h-8`}>
          {more ? <Minus className="size-4" /> : <Plus className="size-4" />}
          {more ? 'Show Fewer Columns' : 'Show More Columns'}
        </button>
      </div>
      <div className="mt-3">
        <DataTable
          columns={more ? [...DAY_COLUMNS, ...MORE_DAY_COLUMNS] : DAY_COLUMNS}
          rows={days}
          rowKey={(row) => row.date ?? ''}
          empty={`RedTrack has no activity for this campaign in the last ${DETAIL_DAYS} days.`}
        />
      </div>
    </>
  )
}

export function Manage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const profiles = useRecords('profiles', { fields: 'Profile Name,Profile ID,Hidden' })
  const [profile, setProfile] = useState(MASTER)
  const [range, setRange] = useState('last_7d')
  const [status, setStatus] = useState('ACTIVE')
  const [account, setAccount] = useState(ALL)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [scheduling, setScheduling] = useState<string | null>(null)
  const [addingTo, setAddingTo] = useState<Campaign | null>(null)
  const [linking, setLinking] = useState<Campaign | null>(null)
  // the campaign whose id was copied last, so its button can confirm it
  const [copied, setCopied] = useState<string>()
  // undefined: not checked; 'checking'; otherwise the campaigns with ads needing attention
  const [review, setReview] = useState<Review[] | 'checking' | { error: string }>()
  // RedTrack ROAS by Facebook campaign id (null: no RedTrack campaign or no spend), for the profile and range in `key`
  const [roas, setRoas] = useState<{ key: string; state: 'loading' | 'done'; values: Map<string, number | null>; error?: string }>()

  const cred = profile === MASTER ? '' : profileCred(profile)
  const overview = useFetch<Overview>(isAdmin ? withCred('/facebook/campaigns', cred, { datePreset: range }) : null)

  // Our own records of campaigns that are on Facebook. One with a RedTrack campaign
  // gives its row the RedTrack breakdown; one with a product lets ads be added to it.
  const records = useRecords('campaigns', {
    fields: 'Name,Status,FB Campaign ID,RedTrack Campaign Id,Product',
    'whereNotEmpty[FB Campaign ID]': '1',
  })

  if (!isAdmin) return <p className="text-sm text-neutral-600">Only admins can manage Facebook campaigns.</p>

  // when two records carry the same Facebook id, the one that is linked to RedTrack counts
  const recordOf = new Map<string, ApiRecord>()
  for (const record of records.records ?? []) {
    const fbId = text(record, 'FB Campaign ID')
    const known = recordOf.get(fbId)
    if (!known || (!text(known, 'RedTrack Campaign Id') && text(record, 'RedTrack Campaign Id'))) recordOf.set(fbId, record)
  }
  const redtrackOf = (campaign: Campaign) => {
    const record = recordOf.get(campaign.id)
    return record ? text(record, 'RedTrack Campaign Id') : ''
  }
  const hasProduct = (campaign: Campaign) => Boolean((recordOf.get(campaign.id)?.fields.Product as string[] | undefined)?.length)

  const term = search.trim().toLowerCase()
  const rows = (overview.data?.campaigns ?? [])
    .filter(
      (campaign) =>
        (status === ALL || campaign.status === status) &&
        (account === ALL || campaign.adAccountId === account) &&
        (campaign.name.toLowerCase().includes(term) || campaign.id.includes(term)),
    )
    // biggest spenders first
    .sort((a, b) => spend(b) - spend(a))
  // the review covers the ticked campaigns, or every one shown when none is ticked
  const toReview = selected.size ? rows.filter((campaign) => selected.has(campaign.id)) : rows

  // ROAS fetched for another profile or range is not shown under this one
  const roasKey = `${profile}|${range}`
  const fetched = roas?.key === roasKey ? roas : undefined

  // RedTrack's ROAS for every campaign loaded. The backend maps each Facebook campaign
  // to its RedTrack campaign and asks RedTrack for the range.
  async function fetchRoas() {
    const campaigns = overview.data?.campaigns ?? []
    setRoas({ key: roasKey, state: 'loading', values: new Map() })
    try {
      // the ranges the route knows by name it resolves in the team's time zone; the rest are sent as dates
      const period = ROAS_PRESETS.includes(range)
        ? { datePreset: range }
        : { dateFrom: datesOf(range).date_from, dateTo: datesOf(range).date_to }
      const found = await api<{ results: { fbCampaignId: string; roas: number | null }[] }>('/manage/roas', {
        method: 'POST',
        body: { fbCampaignIds: campaigns.map((campaign) => campaign.id), ...period },
      })
      // a campaign with no RedTrack campaign linked is left out of the answer and keeps its dash
      const values = new Map<string, number | null>(campaigns.map((campaign) => [campaign.id, null]))
      for (const result of found.results) values.set(result.fbCampaignId, result.roas)
      setRoas({ key: roasKey, state: 'done', values })
    } catch (err) {
      setRoas({ key: roasKey, state: 'done', values: new Map(), error: (err as Error).message })
    }
  }

  async function checkReview() {
    setReview('checking')
    try {
      const found = await api<Review[]>('/facebook/campaigns/ad-review', {
        method: 'POST',
        body: { cred, campaigns: toReview.map(({ id, name, adAccountId }) => ({ id, name, adAccountId })) },
      })
      setReview(found)
    } catch (err) {
      setReview({ error: (err as Error).message })
    }
  }

  const columns: Column<Campaign>[] = [
    {
      header: 'Campaign',
      cell: (campaign) => (
        <>
          {campaign.name}
          <span className="block text-xs font-normal text-neutral-500 tabular-nums">{campaign.id}</span>
        </>
      ),
    },
    { header: 'Ad account', cell: (campaign) => campaign.adAccountName },
    { header: 'Budget', align: 'right', cell: (campaign) => <span className="tabular-nums">{budget(campaign)}</span> },
    { header: 'Spend', align: 'right', cell: (campaign) => <span className="tabular-nums">{dollars(spend(campaign))}</span> },
    {
      header: 'ROAS',
      align: 'right',
      cell: (campaign) => {
        const value = fetched?.values.get(campaign.id)
        return typeof value === 'number' ? (
          <span className={`tabular-nums ${value < 1 ? 'text-red-700' : ''}`}>{value.toFixed(2)}</span>
        ) : (
          <span className="text-neutral-400">{fetched?.state === 'loading' ? '…' : '—'}</span>
        )
      },
    },
    { header: 'Status', cell: (campaign) => <StatusBadge status={title(campaign.status)} /> },
    {
      header: 'Actions',
      align: 'right',
      cell: (campaign) => (
        <span className="-my-1 inline-flex items-center gap-1">
          <Tip label={hasProduct(campaign) ? 'Add ads' : 'Campaign not linked to a product'}>
            {/* a disabled button fires no pointer events, so the span carries the tooltip */}
            <span tabIndex={hasProduct(campaign) ? undefined : 0}>
              <button aria-label="Add ads" disabled={!hasProduct(campaign)} onClick={() => setAddingTo(campaign)} className={button.icon}>
                <ListPlus className="size-4" />
              </button>
            </span>
          </Tip>
          <Tip label="Schedule a budget or status change">
            <button aria-label="Schedule a change" onClick={() => setScheduling(campaign.id)} className={button.icon}>
              <Clock className="size-4" />
            </button>
          </Tip>
          <Tip label={copied === campaign.id ? 'Copied' : 'Copy campaign ID'}>
            <button
              aria-label="Copy campaign ID"
              onClick={() => {
                void navigator.clipboard.writeText(campaign.id)
                setCopied(campaign.id)
              }}
              className={button.icon}
            >
              {copied === campaign.id ? <Check className="size-4 text-emerald-700" /> : <Copy className="size-4" />}
            </button>
          </Tip>
        </span>
      ),
    },
  ]

  const profileOptions = [
    { value: MASTER, label: 'Master profile' },
    ...(profiles.records ?? [])
      .filter((record) => !record.fields.Hidden)
      .map((record) => ({ value: record.id, label: text(record, 'Profile Name') || text(record, 'Profile ID') || record.id })),
  ]
  const failed = overview.data?.failedAdAccounts ?? []
  const totalSpend = rows.reduce((sum, campaign) => sum + spend(campaign), 0)
  const empty = overview.error
    ? `Could not load campaigns from Facebook: ${overview.error.message}`
    : !overview.data
      ? 'Loading from Facebook…'
      : overview.data.campaigns.length
        ? 'No campaign matches these filters.'
        : 'This profile has no campaigns in its active ad accounts.'

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Manage campaigns</h1>
          <p className="mt-1 text-sm text-neutral-600">Live Facebook campaigns across a profile's active ad accounts.</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-neutral-600">
          Profile
          <Select
            label="Profile"
            value={profile}
            options={profileOptions}
            onValueChange={(next) => {
              setProfile(next)
              // ad accounts and campaigns belong to the profile
              setAccount(ALL)
              setSelected(new Set())
            }}
            className="h-9.5 w-52"
          />
          <Tip label="Refresh from Facebook">
            <button onClick={overview.reload} disabled={overview.loading} aria-label="Refresh" className={button.icon}>
              <RefreshCw className={`size-4 ${overview.loading ? 'animate-spin' : ''}`} />
            </button>
          </Tip>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="search"
            aria-label="Search campaigns"
            placeholder="Search by name or ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="block h-9.5 w-full rounded-md border border-neutral-300 bg-white pr-3 pl-8 text-sm outline-none placeholder:text-neutral-400 focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
          />
        </div>
        <Select
          label="Ad account"
          value={account}
          options={[{ value: ALL, label: 'All ad accounts' }, ...(overview.data?.adAccounts ?? []).map((a) => ({ value: a.id, label: a.name }))]}
          onValueChange={setAccount}
          className="h-9.5"
        />
        <Select label="Date range" value={range} options={RANGES} onValueChange={setRange} className="h-9.5" />
        <Select label="Status" value={status} options={STATUSES} onValueChange={setStatus} className="h-9.5" />
        <Tip label="Fill the ROAS column from RedTrack for this date range">
          <button
            onClick={fetchRoas}
            disabled={fetched?.state === 'loading' || !overview.data?.campaigns.length}
            className={`${button.secondary} ml-auto h-9.5`}
          >
            <ChartLine className="size-4" />
            {fetched?.state === 'loading' ? 'Fetching…' : 'Fetch ROAS'}
          </button>
        </Tip>
        <button onClick={checkReview} disabled={review === 'checking' || toReview.length === 0} className={`${button.secondary} h-9.5`}>
          <ShieldCheck className="size-4" />
          {review === 'checking' ? 'Checking…' : selected.size ? `Check ad review (${selected.size})` : 'Check ad review'}
        </button>
      </div>

      {fetched?.error && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          Could not fetch ROAS from RedTrack: {fetched.error}
        </p>
      )}
      {failed.length > 0 && (
        <p role="status" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Facebook would not let this profile read {failed.length === 1 ? 'one ad account' : `${failed.length} ad accounts`}: {failed.join(', ')}.
          Their campaigns are missing from this list.
        </p>
      )}

      <p className="mt-4 text-sm text-neutral-600" aria-live="polite">
        {overview.data &&
          `${rows.length.toLocaleString()} ${rows.length === 1 ? 'campaign' : 'campaigns'} · ${dollars(totalSpend)} spent in this range`}
      </p>
      <div className="mt-2">
        <DataTable
          // new filters start again from page one
          key={`${profile}|${range}|${status}|${account}|${term}`}
          columns={columns}
          rows={rows}
          rowKey={(campaign) => campaign.id}
          empty={empty}
          emptyIsError={Boolean(overview.error)}
          expand={(campaign) => <CampaignDetail redtrackId={redtrackOf(campaign)} />}
          // a campaign with no RedTrack campaign has nothing to expand; it offers the link instead
          expandCell={(campaign) =>
            redtrackOf(campaign) ? undefined : (
              <Tip label="Link RedTrack campaign">
                <button aria-label={`Link a RedTrack campaign to ${campaign.name}`} onClick={() => setLinking(campaign)} className={button.icon}>
                  <Plus className="size-4" />
                </button>
              </Tip>
            )
          }
          selected={selected}
          onSelectedChange={setSelected}
        />
      </div>

      <Dialog.Root open={Array.isArray(review) || (typeof review === 'object' && 'error' in review)} onOpenChange={(open) => !open && setReview(undefined)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-white shadow-xl"
          >
            <div className="flex items-center justify-between gap-4 border-b border-neutral-200 px-6 py-4">
              <Dialog.Title className="text-base font-semibold">Ad review</Dialog.Title>
              <Dialog.Close aria-label="Close" className={button.icon}>
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 text-sm">
              {Array.isArray(review) ? (
                review.length === 0 ? (
                  <p className="text-emerald-800">No ad in the checked campaigns is disapproved, in review or flagged with issues.</p>
                ) : (
                  <ul className="space-y-4">
                    {review.map((campaign) => (
                      <li key={campaign.campaignId}>
                        <p className="font-medium">{campaign.campaignName ?? campaign.campaignId}</p>
                        <ul className="mt-1.5 space-y-1">
                          {campaign.ads.map((ad) => (
                            <li key={ad.id} className="flex items-center gap-3 text-neutral-700">
                              <span className="min-w-0 flex-1 truncate">{ad.name}</span>
                              <StatusBadge status={title(ad.effective_status)} />
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                <p className="text-red-700">Could not check ad review: {typeof review === 'object' && 'error' in review ? review.error : ''}</p>
              )}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {linking && (
        <LinkRedtrackDialog
          campaign={linking}
          record={recordOf.get(linking.id)}
          cred={cred}
          profileId={profile === MASTER ? undefined : profile}
          onClose={() => setLinking(null)}
          onLinked={() => {
            setLinking(null)
            records.reload()
          }}
        />
      )}

      {addingTo && (
        <AddAdsDialog
          fbCampaignId={addingTo.id}
          fbAdAccountId={addingTo.adAccountId}
          cred={cred}
          onClose={() => setAddingTo(null)}
          onAdded={overview.reload}
        />
      )}

      {scheduling && (
        <ScheduleDialog fbCampaignId={scheduling} onClose={() => setScheduling(null)} onScheduled={() => setScheduling(null)} />
      )}
    </>
  )
}
