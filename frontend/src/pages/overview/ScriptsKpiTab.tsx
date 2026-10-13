import { CircleCheck, Hourglass } from 'lucide-react'
import { useEffect, useState } from 'react'
import { DataTable, type Column } from '../../components/DataTable'
import { Select } from '../../components/ui'
import { useFetch } from '../../data'
import { monthLabel, plural, Segmented } from './parts'

// GET /overview/scripts. The API picks the completed scripts, splits them at
// three minutes, fills the empty weeks and counts the unfinished work.
interface Row {
  // 2026-03 for a month, 2026-W14 for a week
  key: string
  shortScripts: number
  longScripts: number
  total: number
  avgDurationSec: number
}

interface Unfinished {
  scripts: number
  editors: number
  variantsRemaining: number
}

interface Scripts {
  granularity: Granularity
  unfinished: Unfinished
  rows: Row[]
  editors: { id: string; name: string | null }[]
}

type Granularity = 'monthly' | 'weekly'

const ALL = 'all'

const count = (value: number) => <span className="tabular-nums">{value.toLocaleString()}</span>

// 127 -> 2m 07s
function duration(seconds: number) {
  const whole = Math.round(seconds)
  if (whole <= 0) return '—'
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, '0')}s`
}

// 2026-W14 -> Week 14, 2026
const weekLabel = (key: string) => `Week ${Number(key.slice(6))}, ${key.slice(0, 4)}`

export function ScriptsKpiTab() {
  const [editorId, setEditorId] = useState(ALL)
  const [granularity, setGranularity] = useState<Granularity>('monthly')
  const query = new URLSearchParams({ granularity, ...(editorId === ALL ? {} : { editorId }) })
  const { data, error } = useFetch<Scripts>(`/overview/scripts?${query}`)

  // the editor list comes with every answer; the last one is kept so the filter stays usable while the next loads
  const [editors, setEditors] = useState<Scripts['editors']>([])
  useEffect(() => {
    if (data) setEditors(data.editors)
  }, [data])

  const monthly = granularity === 'monthly'
  const columns: Column<Row>[] = [
    { header: monthly ? 'Month' : 'Week', cell: (row) => (monthly ? monthLabel(row.key) : weekLabel(row.key)) },
    // exactly three minutes counts as under
    { header: 'Completed Scripts < 3 min', align: 'right', cell: (row) => count(row.shortScripts) },
    { header: 'Completed Scripts > 3 min', align: 'right', cell: (row) => count(row.longScripts) },
    { header: 'Total Completed Scripts', align: 'right', cell: (row) => count(row.total) },
    { header: 'Average Duration', align: 'right', cell: (row) => <span className="tabular-nums">{duration(row.avgDurationSec)}</span> },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="scripts-editor" className="text-sm font-medium text-neutral-700">
          Editor
        </label>
        <Select
          id="scripts-editor"
          value={editorId}
          onValueChange={setEditorId}
          className="min-w-44"
          options={[{ value: ALL, label: 'All Editors' }, ...editors.map((editor) => ({ value: editor.id, label: editor.name || 'Unnamed editor' }))]}
        />
        <div className="ml-auto">
          <Segmented
            label="Period"
            value={granularity}
            onValueChange={setGranularity}
            options={[
              { value: 'monthly', label: 'Monthly' },
              { value: 'weekly', label: 'Weekly' },
            ]}
          />
        </div>
      </div>

      {data && <UnfinishedBanner unfinished={data.unfinished} scoped={editorId !== ALL} />}

      <DataTable
        // back to page one when the filter changes
        key={`${granularity} ${editorId}`}
        columns={columns}
        rows={data?.rows ?? []}
        rowKey={(row) => row.key}
        empty={error ? `Could not load completed scripts: ${error.message}` : data ? 'No completed scripts found.' : 'Loading…'}
        emptyIsError={Boolean(error)}
      />
    </div>
  )
}

// Work assigned to editors and not yet finished, whatever period the table shows
function UnfinishedBanner({ unfinished, scoped }: { unfinished: Unfinished; scoped: boolean }) {
  if (unfinished.scripts === 0) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-800">
        <CircleCheck className="size-4 shrink-0" />
        All assigned scripts are finished{scoped ? '' : ' across every editor'}
      </p>
    )
  }
  return (
    <p role="status" className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-medium text-amber-900">
      <Hourglass className="size-4 shrink-0" />
      {plural(unfinished.scripts, 'unfinished script')}
      {!scoped && ` across ${plural(unfinished.editors, 'editor')}`}
      <span className="ml-auto font-normal">{plural(unfinished.variantsRemaining, 'variant')} still to do</span>
    </p>
  )
}
