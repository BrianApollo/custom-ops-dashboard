import { Check, ChevronDown, Search } from 'lucide-react'
import { Popover } from 'radix-ui'
import { useState, type KeyboardEvent } from 'react'
import { text, type ApiRecord } from '../../lib/api'
import { boxesDone, isLive, TOTAL_BOXES } from './sop'

export const profileName = (record: ApiRecord) => text(record, 'Profile Name') || 'Unnamed profile'

// How far along a profile is: a bar and count while in setup, a badge once live
export function Progress({ record }: { record: ApiRecord }) {
  if (isLive(record)) {
    return <span className="inline-flex rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 ring-1 ring-emerald-600/20 ring-inset">Live</span>
  }
  const done = boxesDone(record)
  return (
    <span className="inline-flex shrink-0 items-center gap-2 text-xs text-neutral-600">
      <span
        role="progressbar"
        aria-label="Setup progress"
        aria-valuemin={0}
        aria-valuemax={TOTAL_BOXES}
        aria-valuenow={done}
        className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-200"
      >
        <span className="block h-full rounded-full bg-blue-700" style={{ width: `${(done / TOTAL_BOXES) * 100}%` }} />
      </span>
      <span className="tabular-nums">
        {done}/{TOTAL_BOXES}
      </span>
    </span>
  )
}

interface Props {
  records: ApiRecord[]
  // the chosen profile's id, '' for none
  value: string
  onValueChange: (id: string) => void
  // profiles with edits that have not been saved
  unsaved: Set<string>
}

// Search by name (email and profile id match too); profiles still in setup come first
export function ProfilePicker({ records, value, onValueChange, unsaved }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [active, setActive] = useState(0)

  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = records
    .filter((record) => {
      const haystack = `${text(record, 'Profile Name')} ${text(record, 'Profile Email')} ${text(record, 'Profile ID')}`.toLowerCase()
      return words.every((word) => haystack.includes(word))
    })
    .sort((a, b) => Number(isLive(a)) - Number(isLive(b)) || profileName(a).localeCompare(profileName(b)))
  const firstLive = matches.findIndex(isLive)
  const selected = records.find((record) => record.id === value)

  function choose(id: string) {
    onValueChange(id)
    setOpen(false)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (matches.length === 0) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = (active + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length
      setActive(next)
      document.getElementById(`profile-option-${next}`)?.scrollIntoView({ block: 'nearest' })
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(matches[Math.min(active, matches.length - 1)].id)
    }
  }

  const heading = (label: string, count: number) => (
    <p className="px-2 pt-2 pb-1 text-xs font-semibold tracking-wide text-neutral-500 uppercase">
      {label} · {count}
    </p>
  )

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setSearch('')
        setActive(0)
      }}
    >
      <Popover.Trigger
        aria-label="Profile"
        className="flex h-10 w-full max-w-md items-center justify-between gap-3 rounded-md border border-neutral-300 bg-white pr-2.5 pl-3 text-left text-sm hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
      >
        <span className={`min-w-0 flex-1 truncate ${selected ? 'font-medium' : 'text-neutral-400'}`}>
          {selected ? profileName(selected) : 'Choose a profile'}
        </span>
        {selected && <Progress record={selected} />}
        <ChevronDown className="size-4 shrink-0 text-neutral-500" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 flex max-h-[min(28rem,var(--radix-popover-content-available-height))] w-(--radix-popover-trigger-width) min-w-80 flex-col rounded-md border border-neutral-200 bg-white shadow-lg"
        >
          <div className="relative border-b border-neutral-200 p-2">
            <Search className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-neutral-400" />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls="profile-options"
              aria-activedescendant={matches.length ? `profile-option-${active}` : undefined}
              aria-label="Search profiles"
              placeholder="Search profiles…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
              className="block w-full rounded-md border border-neutral-300 py-1.5 pr-3 pl-8 text-sm outline-none placeholder:text-neutral-400 focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
            />
          </div>
          <div id="profile-options" role="listbox" aria-label="Profiles" className="min-h-0 flex-1 overflow-y-auto p-1 text-sm">
            {matches.map((record, index) => (
              <div key={record.id}>
                {index === 0 && firstLive !== 0 && heading('In setup', firstLive === -1 ? matches.length : firstLive)}
                {index === firstLive && heading('Live', matches.length - firstLive)}
                <button
                  id={`profile-option-${index}`}
                  role="option"
                  aria-selected={record.id === value}
                  tabIndex={-1}
                  onClick={() => choose(record.id)}
                  onMouseMove={() => setActive(index)}
                  className={`flex w-full items-center gap-3 rounded px-2 py-1.5 text-left ${index === active ? 'bg-neutral-100' : ''}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {profileName(record)}
                      {unsaved.has(record.id) && <span className="ml-2 text-xs font-medium text-amber-700">Unsaved edits</span>}
                    </span>
                    <span className="block truncate text-xs text-neutral-500">{text(record, 'Profile Email') || text(record, 'Profile ID') || 'No email yet'}</span>
                  </span>
                  <Progress record={record} />
                  <Check className={`size-4 shrink-0 text-blue-700 ${record.id === value ? '' : 'invisible'}`} />
                </button>
              </div>
            ))}
            {matches.length === 0 && <p className="px-2 py-3 text-neutral-500">{records.length ? 'Nothing matches.' : 'No profiles to show.'}</p>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
