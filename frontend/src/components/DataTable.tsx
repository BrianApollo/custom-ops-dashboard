import { Check, ChevronLeft, ChevronRight, Minus } from 'lucide-react'
import { Checkbox } from 'radix-ui'
import { Fragment, useState, type ReactNode } from 'react'
import { button, Select } from './ui'

export interface Column<T> {
  header: string
  cell: (row: T) => ReactNode
  align?: 'right'
  // neighbouring columns with the same group share one heading above their own
  group?: string
  // needed only when two columns have the same header, e.g. `Available` under two groups
  key?: string
}

interface Props<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  // shown in place of the rows when there are none
  empty: string
  // red instead of grey, for a failed load
  emptyIsError?: boolean
  // the detail shown under a row when it is expanded; adds the chevron column
  expand?: (row: T) => ReactNode
  // What takes the chevron's place on a row that has no detail to show, e.g. a button
  // that sets the detail up. Return nothing for a row that can be expanded.
  expandCell?: (row: T) => ReactNode
  // the selected row keys; passing both adds the checkbox column
  selected?: Set<string>
  onSelectedChange?: (selected: Set<string>) => void
}

const PAGE_SIZES = [25, 50, 100]

export const checkbox =
  'flex size-4 items-center justify-center rounded border border-neutral-400 bg-white text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 data-[state=checked]:border-blue-700 data-[state=checked]:bg-blue-700 data-[state=indeterminate]:border-blue-700 data-[state=indeterminate]:bg-blue-700'

// The one table every list in the dashboard uses. It pages on the client:
// lists arrive whole from the API, so paging here costs no extra requests.
// Give it a `key` that changes with the filters to send it back to page one.
export function DataTable<T>({ columns, rows, rowKey, empty, emptyIsError, expand, expandCell, selected, onSelectedChange }: Props<T>) {
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [wantedPage, setWantedPage] = useState(0)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  // rows can shrink under the current page, e.g. after a refresh
  const page = Math.min(wantedPage, pages - 1)
  const visible = rows.slice(page * pageSize, (page + 1) * pageSize)
  const selectable = selected && onSelectedChange
  const span = columns.length + (expand ? 1 : 0) + (selectable ? 1 : 0)
  const grouped = columns.some((column) => column.group)
  const headerRows = grouped ? 2 : 1
  const keyOf = (column: Column<T>) => column.key ?? column.header

  const visibleKeys = visible.map(rowKey)
  const chosen = visibleKeys.filter((key) => selected?.has(key)).length

  function toggle(set: Set<string>, keys: string[], on: boolean) {
    const next = new Set(set)
    for (const key of keys) {
      if (on) next.add(key)
      else next.delete(key)
    }
    return next
  }

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs tracking-wide text-neutral-600 uppercase">
            <tr>
              {selectable && (
                <th rowSpan={headerRows} className="w-10 py-2.5 pl-4">
                  <Checkbox.Root
                    aria-label="Select every row on this page"
                    checked={chosen === 0 ? false : chosen === visible.length ? true : 'indeterminate'}
                    onCheckedChange={(on) => onSelectedChange(toggle(selected, visibleKeys, on === true))}
                    className={checkbox}
                  >
                    <Checkbox.Indicator>
                      {chosen === visible.length ? <Check className="size-3" /> : <Minus className="size-3" />}
                    </Checkbox.Indicator>
                  </Checkbox.Root>
                </th>
              )}
              {expand && <th rowSpan={headerRows} className="w-10" />}
              {columns.map((column, i) => {
                if (!column.group) {
                  return (
                    <th key={keyOf(column)} rowSpan={headerRows} className={`px-4 py-2.5 font-medium ${column.align === 'right' ? 'text-right' : ''}`}>
                      {column.header}
                    </th>
                  )
                }
                // the group's heading is drawn once, over its first column, and spans the rest
                if (columns[i - 1]?.group === column.group) return null
                const span = columns.slice(i).findIndex((next) => next.group !== column.group)
                return (
                  <th
                    key={`group-${column.group}`}
                    colSpan={span === -1 ? columns.length - i : span}
                    className="border-b border-l border-neutral-200 px-4 py-2 text-center font-semibold text-neutral-800"
                  >
                    {column.group}
                  </th>
                )
              })}
            </tr>
            {grouped && (
              <tr>
                {columns.map(
                  (column, i) =>
                    column.group && (
                      <th
                        key={keyOf(column)}
                        className={`px-4 py-2 font-medium ${column.align === 'right' ? 'text-right' : ''} ${columns[i - 1]?.group === column.group ? '' : 'border-l border-neutral-200'}`}
                      >
                        {column.header}
                      </th>
                    ),
                )}
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {visible.map((row) => {
              const key = rowKey(row)
              const instead = expand ? expandCell?.(row) : undefined
              const open = !instead && expanded.has(key)
              return (
                <Fragment key={key}>
                  <tr className={selected?.has(key) ? 'bg-blue-50/60' : 'hover:bg-neutral-50'}>
                    {selectable && (
                      <td className="py-2.5 pl-4">
                        <Checkbox.Root
                          aria-label="Select row"
                          checked={selected.has(key)}
                          onCheckedChange={(on) => onSelectedChange(toggle(selected, [key], on === true))}
                          className={checkbox}
                        >
                          <Checkbox.Indicator>
                            <Check className="size-3" />
                          </Checkbox.Indicator>
                        </Checkbox.Root>
                      </td>
                    )}
                    {expand && (
                      <td className="pl-2">
                        {instead ?? (
                          <button
                            aria-label={open ? 'Hide details' : 'Show details'}
                            aria-expanded={open}
                            onClick={() => setExpanded(toggle(expanded, [key], !open))}
                            className={button.icon}
                          >
                            <ChevronRight className={`size-4 ${open ? 'rotate-90' : ''}`} />
                          </button>
                        )}
                      </td>
                    )}
                    {columns.map((column, i) => (
                      <td
                        key={keyOf(column)}
                        className={`px-4 py-2.5 ${i === 0 ? 'font-medium' : 'text-neutral-700'} ${column.align === 'right' ? 'text-right' : ''} ${column.group && columns[i - 1]?.group !== column.group ? 'border-l border-neutral-100' : ''}`}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                  {expand && open && (
                    <tr className="bg-neutral-50">
                      <td colSpan={span} className="px-4 py-3">
                        {expand(row)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      {rows.length === 0 && (
        <p className={`px-4 py-10 text-center text-sm ${emptyIsError ? 'text-red-700' : 'text-neutral-500'}`}>{empty}</p>
      )}

      <Pager
        className="border-t border-neutral-200 px-4 py-2"
        noun="Rows"
        total={rows.length}
        page={page}
        pageSize={pageSize}
        pageSizes={PAGE_SIZES}
        onPage={setWantedPage}
        onPageSize={(size) => {
          setPageSize(size)
          setWantedPage(0)
        }}
      />
    </div>
  )
}

interface PagerProps {
  // what one page holds, e.g. `Rows`
  noun: string
  total: number
  // zero-based
  page: number
  pageSize: number
  pageSizes: number[]
  onPage: (page: number) => void
  onPageSize: (size: number) => void
  className?: string
}

// Page size, position and previous/next. Renders nothing for a list that fits on the smallest page.
export function Pager({ noun, total, page, pageSize, pageSizes, onPage, onPageSize, className = '' }: PagerProps) {
  if (total <= pageSizes[0]) return null
  const pages = Math.ceil(total / pageSize)
  return (
    <div className={`flex flex-wrap items-center justify-end gap-x-6 gap-y-2 text-sm text-neutral-600 ${className}`}>
      <div className="flex items-center gap-2">
        {noun} per page
        <Select
          label={`${noun} per page`}
          value={String(pageSize)}
          options={pageSizes.map(String)}
          onValueChange={(value) => onPageSize(Number(value))}
        />
      </div>
      <span className="tabular-nums" aria-live="polite">
        {(page * pageSize + 1).toLocaleString()}–{Math.min((page + 1) * pageSize, total).toLocaleString()} of{' '}
        {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <button aria-label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)} className={button.icon}>
          <ChevronLeft className="size-4" />
        </button>
        <button aria-label="Next page" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} className={button.icon}>
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  )
}
