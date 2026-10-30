import { RefreshCw, Search } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useRecords, type Product } from '../data'
import type { ApiRecord } from '../lib/api'
import { DataTable, type Column } from './DataTable'
import { matchesSearch } from '../lib/search'
import { RecordDialog } from './RecordDialog'
import { button, StatusChips, Tip } from './ui'

interface Props {
  // e.g. `campaigns`
  table: string
  // singular and plural, for counts and empty states
  noun: [string, string]
  // the record's display name: what the search matches and the dialog is titled
  name: (record: ApiRecord) => string
  fields: string[]
  columns: Column<ApiRecord>[]
  product?: Product
  // buttons shown after the refresh button
  toolbar?: ReactNode
  // adds one filter chip per status, each with its count
  statusOf?: (record: ApiRecord) => string
  // the chips to show, in order, even when their count is zero. A status found in the data but
  // not listed gets a chip after these. Without this, one chip per status found.
  statuses?: string[]
  // the chip selected at first
  defaultStatus?: string
  // the detail shown under an expanded row
  expand?: (record: ApiRecord) => ReactNode
  selectable?: boolean
  // the buttons in each row's Actions cell, in place of the default View. `reload` refetches
  // the list and `view` opens the default detail dialog.
  rowActions?: (record: ApiRecord, reload: () => void, view: () => void) => ReactNode
  // runs with the refresh button, for data the columns read from elsewhere
  onRefresh?: () => void
}

// One tab's list: status chips, search and refresh above the shared table, and a detail dialog
export function RecordList(props: Props) {
  const { table, noun, name, fields, columns, product, toolbar, statusOf, statuses, defaultStatus, expand } = props
  const query: Record<string, string> = { fields: fields.join(',') }
  if (product) query['where[Product]'] = product.id
  const { records, error, loading, reload } = useRecords(table, query)
  const [search, setSearch] = useState('')
  const [viewing, setViewing] = useState<{ id: string; title: string } | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // undefined until a chip is clicked; '' once the selected chip is clicked off
  const [picked, setPicked] = useState<string>()

  const term = search.trim().toLowerCase()
  const searched = (records ?? []).filter((record) => matchesSearch(term, name(record)))

  const statusCounts = new Map<string, number>()
  if (statusOf) {
    for (const record of searched) statusCounts.set(statusOf(record), (statusCounts.get(statusOf(record)) ?? 0) + 1)
  }
  const found = [...statusCounts.keys()].sort()
  const chips = statuses ? [...statuses, ...found.filter((name) => !statuses.includes(name))] : found
  const status = picked ?? (defaultStatus && chips.includes(defaultStatus) ? defaultStatus : '')

  const rows = searched
    .filter((record) => !status || statusOf!(record) === status)
    // newest first
    .sort((a, b) => b.createdTime.localeCompare(a.createdTime))

  let empty: string
  if (error) empty = `Could not load ${noun[1]}: ${error}`
  else if (!records) empty = 'Loading…'
  else if (term || status) empty = `No ${noun[0]} matches the search and status filter.`
  else empty = `No ${noun[1]} ${product ? `for ${product.name} ` : ''}yet.`

  const actions: Column<ApiRecord> = {
    header: 'Actions',
    align: 'right',
    cell: (record) =>
      props.rowActions ? (
        // one line, so every row is the same height and the last button lines up down the column
        <span className="-my-1 inline-flex items-center justify-end gap-1 whitespace-nowrap">{props.rowActions(record, reload, () => setViewing({ id: record.id, title: name(record) }))}</span>
      ) : (
      <button onClick={() => setViewing({ id: record.id, title: name(record) })} className={`${button.secondary} -my-1`}>
        View
      </button>
      ),
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {statusOf && chips.length > 0 && <StatusChips chips={chips} counts={statusCounts} value={status} onValueChange={setPicked} />}
        <p className="text-sm text-neutral-600" aria-live="polite">
          {selected.size > 0 ? (
            <>
              {selected.size.toLocaleString()} selected ·{' '}
              <button onClick={() => setSelected(new Set())} className="text-blue-700 hover:underline">
                Clear
              </button>
            </>
          ) : records ? (
            `${rows.length.toLocaleString()} ${rows.length === 1 ? noun[0] : noun[1]}`
          ) : (
            ''
          )}
        </p>
        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="search"
            aria-label={`Search ${noun[1]}`}
            placeholder={`Search ${noun[1]}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="block w-full rounded-md border border-neutral-300 bg-white py-1.5 pr-3 pl-8 text-sm outline-none placeholder:text-neutral-400 focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
          />
        </div>
        <Tip label="Refresh">
          <button
            onClick={() => {
              reload()
              props.onRefresh?.()
            }}
            disabled={loading}
            aria-label="Refresh"
            className={button.icon}
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </Tip>
        {toolbar}
      </div>

      <div className="mt-3">
        <DataTable
          // a new search, status or product starts again from page one
          key={`${term}|${status}|${product?.id}`}
          columns={[...columns, actions]}
          rows={rows}
          rowKey={(record) => record.id}
          empty={empty}
          emptyIsError={Boolean(error)}
          expand={expand}
          selected={props.selectable ? selected : undefined}
          onSelectedChange={props.selectable ? setSelected : undefined}
        />
      </div>

      <RecordDialog table={table} record={viewing} onClose={() => setViewing(null)} />
    </>
  )
}
