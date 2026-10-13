import { Check, ChevronRight, Minus, RefreshCw, Search } from 'lucide-react'
import { Checkbox } from 'radix-ui'
import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { useFetch, useRecords } from '../../data'
import { text } from '../../lib/api'
import { checkbox, Pager, type Column } from '../DataTable'
import { button, Tip } from '../ui'

export const PAGE_SIZES = [25, 50, 100]

interface Props<T> {
  columns: Column<T>[]
  // one page of rows, as the server returned it
  rows: T[]
  rowKey: (row: T) => string
  // shown in place of the rows when there are none
  empty: string
  emptyIsError?: boolean
  // the detail shown under a row when it is expanded; adds the chevron column
  expand?: (row: T) => ReactNode
  // the selected row keys, which may include rows on other pages; passing both adds the checkbox column
  selected?: Set<string>
  onSelectedChange?: (selected: Set<string>) => void
  // the next page is on its way: the rows on screen are dimmed
  loading?: boolean
  // rows matching the filters on every page
  total: number
  // zero-based
  page: number
  pageSize: number
  onPage: (page: number) => void
  onPageSize: (size: number) => void
}

// The shared DataTable, for a list the server pages. DataTable slices its rows itself, so it
// cannot show one page of a longer list; this draws the same table around the rows it is given
// and leaves page changes to the caller.
export function ServerTable<T>(props: Props<T>) {
  const { columns, rows, rowKey, empty, emptyIsError, expand, selected, onSelectedChange, loading, total, page, pageSize } = props
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const selectable = selected && onSelectedChange
  const span = columns.length + (expand ? 1 : 0) + (selectable ? 1 : 0)
  const keyOf = (column: Column<T>) => column.key ?? column.header

  const keys = rows.map(rowKey)
  const chosen = keys.filter((key) => selected?.has(key)).length

  function toggle(set: Set<string>, changed: string[], on: boolean) {
    const next = new Set(set)
    for (const key of changed) {
      if (on) next.add(key)
      else next.delete(key)
    }
    return next
  }

  return (
    <div className="overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <div className="overflow-x-auto">
        <table className={`w-full text-left text-sm ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs tracking-wide text-neutral-600 uppercase">
            <tr>
              {selectable && (
                <th className="w-10 py-2.5 pl-4">
                  <Checkbox.Root
                    aria-label="Select every row on this page"
                    checked={chosen === 0 ? false : chosen === rows.length ? true : 'indeterminate'}
                    onCheckedChange={(on) => onSelectedChange(toggle(selected, keys, on === true))}
                    className={checkbox}
                  >
                    <Checkbox.Indicator>{chosen === rows.length ? <Check className="size-3" /> : <Minus className="size-3" />}</Checkbox.Indicator>
                  </Checkbox.Root>
                </th>
              )}
              {expand && <th className="w-10" />}
              {columns.map((column) => (
                <th key={keyOf(column)} className={`px-4 py-2.5 font-medium ${column.align === 'right' ? 'text-right' : ''}`}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((row) => {
              const key = rowKey(row)
              const open = expanded.has(key)
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
                        <button
                          aria-label={open ? 'Hide details' : 'Show details'}
                          aria-expanded={open}
                          onClick={() => setExpanded(toggle(expanded, [key], !open))}
                          className={button.icon}
                        >
                          <ChevronRight className={`size-4 ${open ? 'rotate-90' : ''}`} />
                        </button>
                      </td>
                    )}
                    {columns.map((column, i) => (
                      <td
                        key={keyOf(column)}
                        className={`px-4 py-2.5 ${i === 0 ? 'font-medium' : 'text-neutral-700'} ${column.align === 'right' ? 'text-right' : ''}`}
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
        total={total}
        page={page}
        pageSize={pageSize}
        pageSizes={PAGE_SIZES}
        onPage={props.onPage}
        onPageSize={props.onPageSize}
      />
    </div>
  )
}

// A server-paged list. While the next page or filter loads, the previous answer stays on
// screen, so the table does not blink empty between pages.
export function useServerList<T>(path: string) {
  const { data, error, loading, reload } = useFetch<T>(path)
  const [last, setLast] = useState<T>()
  if (data && data !== last) setLast(data)
  return { data: data ?? (error ? undefined : last), error, loading, reload }
}

// The value, once it has stopped changing for a moment: a search box asks the server when typing pauses
export function useDebounced<T>(value: T, ms = 300) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return settled
}

export interface Editor {
  id: string
  name: string
  // false for an editor whose account is switched off; only admins are told
  active: boolean
}

// Everyone with the Video Editor role, by name. `withActive` asks for the Active flag, which only admins may read.
export function useEditors(withActive = false) {
  const users = useRecords('users', { fields: withActive ? 'Name,Role,Active' : 'Name,Role' })
  const editors: Editor[] = (users.records ?? [])
    .filter((user) => text(user, 'Role').trim().toLowerCase() === 'video editor')
    .map((user) => ({ id: user.id, name: text(user, 'Name') || 'Unnamed', active: withActive ? Boolean(user.fields.Active) : true }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return { editors, error: users.error, loaded: Boolean(users.records) }
}

interface SearchProps {
  // plural, e.g. `scripts`
  noun: string
  value: string
  onChange: (value: string) => void
  loading: boolean
  onRefresh: () => void
}

// The search box and refresh button at the right of a list's toolbar
export function SearchAndRefresh({ noun, value, onChange, loading, onRefresh }: SearchProps) {
  return (
    <>
      <div className="relative ml-auto w-full max-w-xs">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-neutral-400" />
        <input
          type="search"
          aria-label={`Search ${noun}`}
          placeholder={`Search ${noun}…`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full rounded-md border border-neutral-300 bg-white py-1.5 pr-3 pl-8 text-sm outline-none placeholder:text-neutral-400 focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
        />
      </div>
      <Tip label="Refresh">
        <button onClick={onRefresh} disabled={loading} aria-label="Refresh" className={button.icon}>
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </Tip>
    </>
  )
}
