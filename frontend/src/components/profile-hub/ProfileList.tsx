import { Plus, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { text, type ApiRecord } from '../../lib/api'
import { button, Tip } from '../ui'
import { displayName, F, hasName, isDead, isLive, rotation, stateOf, uidOf, type State } from './model'

type Filter = 'all' | 'active' | 'dead'

interface Props {
  records: ApiRecord[]
  // the open profile's id, '' for none
  value: string
  onValueChange: (id: string) => void
  onAdd: () => void
  // profiles with edits that have not been saved
  unsaved: Set<string>
}

// The short state shown at the end of a row
export function StateChip({ record }: { record: ApiRecord }) {
  const state = stateOf(record)
  const status = text(record, F.status)
  const tone: Record<State, string> = {
    dead: status === 'Banned' ? 'bg-red-50 text-red-800 ring-red-600/20' : 'bg-neutral-100 text-neutral-600 ring-neutral-500/20',
    live: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
    unrecorded: 'bg-neutral-100 text-neutral-600 ring-neutral-500/20',
    received: 'bg-neutral-100 text-neutral-700 ring-neutral-500/20',
    rotating: 'bg-blue-50 text-blue-800 ring-blue-600/20',
    rotated: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  }
  const { done, total } = rotation(record)
  const label: Record<State, string> = {
    dead: status || 'Dead',
    live: 'Live',
    unrecorded: 'No received data',
    received: 'Received',
    rotating: `Rotating ${done}/${total}`,
    rotated: 'Fully rotated',
  }
  return <span className={`inline-flex shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset ${tone[state]}`}>{label[state]}</span>
}

const matches = (record: ApiRecord, words: string[]) => {
  const haystack = `${text(record, F.name)} ${text(record, F.fbEmail)} ${text(record, F.mailboxEmail)} ${uidOf(record)}`.toLowerCase()
  return words.every((word) => haystack.includes(word))
}

// Search, Active/Dead filter and the list in three groups: In setup, Live, Dead (greyed)
export function ProfileList({ records, value, onValueChange, onAdd, unsaved }: Props) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('active')

  const counts = useMemo(() => {
    const dead = records.filter(isDead).length
    return { all: records.length, active: records.length - dead, dead }
  }, [records])

  const groups = useMemo(() => {
    const words = search.toLowerCase().split(/\s+/).filter(Boolean)
    const shown = records
      .filter((record) => matches(record, words))
      .filter((record) => (filter === 'all' ? true : filter === 'dead' ? isDead(record) : !isDead(record)))
      .sort((a, b) => displayName(a).localeCompare(displayName(b)))
    return [
      { label: 'In setup', rows: shown.filter((record) => !isDead(record) && !isLive(record)) },
      { label: 'Live', rows: shown.filter((record) => !isDead(record) && isLive(record)) },
      { label: 'Dead', rows: shown.filter(isDead), dim: true },
    ].filter((group) => group.rows.length > 0)
  }, [records, search, filter])

  const chip = (key: Filter, label: string) => (
    <button
      key={key}
      type="button"
      onClick={() => setFilter(key)}
      aria-pressed={filter === key}
      className={`inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-700 ${
        filter === key
          ? key === 'dead'
            ? 'border-red-200 bg-red-50 text-red-800'
            : 'border-blue-200 bg-blue-50 text-blue-800'
          : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'
      }`}
    >
      <span className="tabular-nums">{counts[key]}</span> {label}
    </button>
  )

  return (
    <aside className="flex h-full min-h-0 w-72 shrink-0 flex-col rounded-lg border border-neutral-200 bg-white">
      <div className="space-y-2.5 border-b border-neutral-200 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-neutral-400" />
          <input
            aria-label="Search profiles"
            placeholder="Search name, email or UID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="block h-9 w-full rounded-md border border-neutral-300 bg-white pr-3 pl-8 text-sm outline-none placeholder:text-neutral-400 focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {chip('all', 'All')}
          {chip('active', 'Active')}
          {chip('dead', 'Dead')}
          <Tip label="Add a profile">
            <button type="button" aria-label="Add a profile" onClick={onAdd} className={`${button.secondary} ml-auto size-7 px-0`}>
              <Plus className="size-4" />
            </button>
          </Tip>
        </div>
      </div>

      <div role="listbox" aria-label="Profiles" className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {groups.map((group) => (
          <div key={group.label}>
            <p className="px-2 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-neutral-500 uppercase">
              {group.label} · {group.rows.length}
            </p>
            {group.rows.map((record) => (
              <button
                key={record.id}
                type="button"
                role="option"
                aria-selected={record.id === value}
                onClick={() => onValueChange(record.id)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left ${record.id === value ? 'bg-blue-50' : 'hover:bg-neutral-100'} ${group.dim ? 'opacity-60' : ''}`}
              >
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${record.id === value ? 'font-semibold text-blue-900' : 'font-medium'} ${hasName(record) ? '' : 'italic text-neutral-600'}`}>
                    {displayName(record)}
                    {unsaved.has(record.id) && <span className="ml-1.5 text-[11px] font-medium text-amber-700 not-italic">Unsaved</span>}
                  </span>
                  <span className="block truncate font-mono text-[11px] text-neutral-500">{uidOf(record) || text(record, F.fbEmail) || 'No UID yet'}</span>
                </span>
                <StateChip record={record} />
              </button>
            ))}
          </div>
        ))}
        {groups.length === 0 && <p className="px-2 py-6 text-center text-sm text-neutral-500">{records.length ? 'Nothing matches.' : 'No profiles yet.'}</p>}
      </div>
    </aside>
  )
}
