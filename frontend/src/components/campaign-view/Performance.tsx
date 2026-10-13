import { Minus, Plus } from 'lucide-react'
import { useState } from 'react'
import { useFetch } from '../../data'
import { DataTable, type Column } from '../DataTable'
import { button, Select } from '../ui'
import { alertBox, dollars } from './shared'

// One day of RedTrack's report for a campaign
interface Day {
  date?: string
  cost?: number
  total_revenue?: number
  total_conversions?: number
  clicks?: number
}

// RedTrack answers with the rows, or wraps them in `items`
type Report = Day[] | { items?: Day[] }

const RANGES = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
]

// revenue per dollar of cost, and profit as a share of cost; undefined when nothing was spent
const roasOf = (row: Day) => (row.cost ? (row.total_revenue ?? 0) / row.cost : undefined)
const roiOf = (row: Day) => (row.cost ? ((row.total_revenue ?? 0) - row.cost) / row.cost : undefined)
const ratio = (value: number | undefined) => (value === undefined ? '—' : value.toFixed(2))
const percent = (value: number | undefined) => (value === undefined ? '—' : `${(value * 100).toFixed(1)}%`)
const perPurchase = (amount: number | undefined, row: Day) => (row.total_conversions ? dollars((amount ?? 0) / row.total_conversions) : '—')

// a date in the browser's zone as YYYY-MM-DD, `days` from today
function day(days = 0) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const number = (value: string) => <span className="tabular-nums">{value}</span>

const COLUMNS: Column<Day>[] = [
  { header: 'Date', cell: (row) => number(row.date ?? '') },
  { header: 'Cost', align: 'right', cell: (row) => number(dollars(row.cost ?? 0)) },
  { header: 'Purchases', align: 'right', cell: (row) => number((row.total_conversions ?? 0).toLocaleString()) },
  { header: 'Revenue', align: 'right', cell: (row) => number(dollars(row.total_revenue ?? 0)) },
  { header: 'ROAS', align: 'right', cell: (row) => number(ratio(roasOf(row))) },
  {
    header: 'ROI',
    align: 'right',
    cell: (row) => <span className={`tabular-nums ${(roiOf(row) ?? 0) < 0 ? 'text-red-700' : ''}`}>{percent(roiOf(row))}</span>,
  },
]

const MORE_COLUMNS: Column<Day>[] = [
  { header: 'Clicks', align: 'right', cell: (row) => number((row.clicks ?? 0).toLocaleString()) },
  { header: 'Profit', align: 'right', cell: (row) => number(dollars((row.total_revenue ?? 0) - (row.cost ?? 0))) },
  { header: 'Cost per purchase', align: 'right', cell: (row) => number(perPurchase(row.cost, row)) },
  { header: 'Revenue per purchase', align: 'right', cell: (row) => number(perPurchase(row.total_revenue, row)) },
]

// The campaign's RedTrack numbers: totals for the range, then one row per day
export function Performance({ redtrackId }: { redtrackId: string }) {
  const [range, setRange] = useState('30')
  const [more, setMore] = useState(false)
  const report = useFetch<Report>(
    redtrackId
      ? `/redtrack/report?${new URLSearchParams({
          group: 'date',
          campaign_id: redtrackId,
          date_from: day(-Number(range)),
          date_to: day(),
          fields: 'date,cost,total_revenue,total_conversions,clicks',
        })}`
      : null,
  )

  if (!redtrackId) {
    return (
      <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500">
        No RedTrack campaign is linked to this campaign, so there are no numbers to show.
      </p>
    )
  }

  const rows = Array.isArray(report.data) ? report.data : (report.data?.items ?? [])
  // newest day first
  const days = [...rows].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  const total: Day = {
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
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select label="Date range" value={range} options={RANGES} onValueChange={setRange} className="h-8" />
        <button onClick={() => setMore(!more)} aria-pressed={more} className={`${button.secondary} h-8`}>
          {more ? <Minus className="size-4" /> : <Plus className="size-4" />}
          {more ? 'Show Fewer Columns' : 'Show More Columns'}
        </button>
      </div>
      {report.error ? (
        <p role="alert" className={alertBox}>
          Could not load RedTrack numbers: {report.error.message}
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {cards.map((card) => (
              <div key={card.label} className="rounded-lg border border-neutral-200 bg-white px-4 py-3">
                <dt className="text-xs text-neutral-500">{card.label}</dt>
                <dd className={`mt-1 text-lg font-semibold tabular-nums ${card.negative ? 'text-red-700' : ''}`}>{report.data ? card.value : '…'}</dd>
              </div>
            ))}
          </dl>
          <DataTable
            key={range}
            columns={more ? [...COLUMNS, ...MORE_COLUMNS] : COLUMNS}
            rows={days}
            rowKey={(row) => row.date ?? ''}
            empty={report.data ? 'RedTrack has no activity for this campaign in this range.' : 'Loading from RedTrack…'}
          />
        </>
      )}
    </div>
  )
}
