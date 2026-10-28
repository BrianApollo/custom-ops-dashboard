import { Check, ChevronDown, Search, X } from 'lucide-react'
import { Popover, Select as RadixSelect, ToggleGroup, Tooltip } from 'radix-ui'
import { useState, type KeyboardEvent, type ReactNode } from 'react'

// Shared class strings, so buttons and inputs look the same on every page
export const button = {
  primary:
    'inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500',
  secondary:
    'inline-flex items-center justify-center gap-1.5 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium text-neutral-800 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60',
  icon: 'inline-flex size-8 items-center justify-center rounded-md text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-blue-700 disabled:opacity-60',
}

export const input =
  'block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none placeholder:text-neutral-400 focus:border-blue-700 focus:ring-1 focus:ring-blue-700'

const TONES: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-800 ring-blue-600/20',
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  red: 'bg-red-50 text-red-800 ring-red-600/20',
  neutral: 'bg-neutral-100 text-neutral-700 ring-neutral-500/20',
}

// Statuses come from the data as free text; ones not listed here show as neutral
const STATUS_TONE: Record<string, keyof typeof TONES> = {
  active: 'green',
  launched: 'green',
  available: 'green',
  checked: 'green',
  assigned: 'green',
  approved: 'green',
  pending: 'amber',
  success: 'green',
  unassigned: 'red',
  preparing: 'blue',
  new: 'blue',
  'in review': 'blue',
  'in progress': 'blue',
  paused: 'amber',
  'to do': 'amber',
  cancelled: 'red',
  failed: 'red',
  disapproved: 'red',
  'with issues': 'red',
  'pending review': 'amber',
  error: 'red',
}

export const statusTone = (status: string) => TONES[STATUS_TONE[status.toLowerCase()] ?? 'neutral']

export function StatusBadge({ status }: { status: string }) {
  if (!status) return <span className="text-neutral-400">—</span>
  const tone = statusTone(status)
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${tone}`}>
      {status}
    </span>
  )
}

interface ChipsProps {
  chips: string[]
  counts: Map<string, number>
  // the selected chip, '' for none
  value: string
  onValueChange: (value: string) => void
}

// Status filter: one chip per status with its count. Clicking the selected chip clears the filter.
export function StatusChips({ chips, counts, value, onValueChange }: ChipsProps) {
  return (
    <ToggleGroup.Root
      type="single"
      value={value}
      onValueChange={onValueChange}
      aria-label="Filter by status"
      className="flex flex-wrap gap-1.5"
    >
      {chips.map((chip) => (
        <ToggleGroup.Item
          key={chip}
          value={chip}
          className={`rounded-md px-2 py-1 text-xs font-medium ring-1 ring-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 data-[state=off]:opacity-70 data-[state=off]:hover:opacity-100 data-[state=on]:ring-2 data-[state=on]:ring-blue-700 ${statusTone(chip)}`}
        >
          <span className="tabular-nums">{(counts.get(chip) ?? 0).toLocaleString()}</span> {chip}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}

interface SelectProps {
  value: string
  options: (string | { value: string; label: string })[]
  // shown while the value is ''
  placeholder?: string
  disabled?: boolean
  onValueChange: (value: string) => void
  // for a select with no visible <label>
  label?: string
  id?: string
  className?: string
}

export function Select({ value, options, placeholder, disabled, onValueChange, label, id, className = '' }: SelectProps) {
  const items = options.map((option) => (typeof option === 'string' ? { value: option, label: option } : option))
  return (
    <RadixSelect.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <RadixSelect.Trigger
        id={id}
        aria-label={label}
        className={`inline-flex h-8 items-center justify-between gap-2 rounded-md border border-neutral-300 bg-white px-2.5 text-sm text-neutral-900 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${className}`}
      >
        <span className="truncate">
          <RadixSelect.Value placeholder={<span className="text-neutral-400">{placeholder}</span>} />
        </span>
        <RadixSelect.Icon>
          <ChevronDown className="size-4 text-neutral-500" />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="z-50 max-h-(--radix-select-content-available-height) max-w-[min(32rem,90vw)] min-w-(--radix-select-trigger-width) overflow-y-auto rounded-md border border-neutral-200 bg-white p-1 text-sm shadow-lg"
        >
          <RadixSelect.Viewport>
            {items.map((option) => (
              <RadixSelect.Item
                key={option.value}
                value={option.value}
                className="flex cursor-default items-center justify-between gap-3 rounded px-2 py-1.5 outline-none data-highlighted:bg-neutral-100"
              >
                <RadixSelect.ItemText>{option.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator>
                  <Check className="size-4 text-blue-700" />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  )
}

interface ComboboxProps {
  value: string
  // `detail` is a quieter second piece of text (an id, say) that the search also matches;
  // `badge` is a status shown as a coloured tag after the name
  options: { value: string; label: string; detail?: string; badge?: string }[]
  // shown on the closed field while nothing is chosen
  placeholder: string
  disabled?: boolean
  // what the list holds, e.g. `RedTrack campaigns`
  noun: string
  // '' clears the choice
  onValueChange: (value: string) => void
  id?: string
  className?: string
}

// Long lists are searched, not scrolled; only the first matches are drawn
const COMBOBOX_MAX = 100

// A select with a search box, for lists too long to scan
export function Combobox({ value, options, placeholder, disabled, noun, onValueChange, id, className = '' }: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [active, setActive] = useState(0)

  // every word typed must appear somewhere, in any order: `fb us keto` finds `Keto - US - FB`
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = options.filter((option) => {
    const haystack = `${option.label} ${option.detail ?? ''}`.toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
  const shown = matches.slice(0, COMBOBOX_MAX)
  const selected = options.find((option) => option.value === value)

  function choose(next: string) {
    onValueChange(next)
    setOpen(false)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (shown.length === 0) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = (active + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length
      setActive(next)
      document.getElementById(`${id}-option-${next}`)?.scrollIntoView({ block: 'nearest' })
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(shown[Math.min(active, shown.length - 1)].value)
    }
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        setSearch('')
        setActive(0)
      }}
    >
      <div className={`relative ${className}`}>
        <Popover.Trigger
          id={id}
          disabled={disabled}
          className="flex size-full items-center justify-between gap-2 rounded-md border border-neutral-300 bg-white pr-2.5 pl-3 text-left text-sm hover:bg-neutral-50 disabled:cursor-not-allowed disabled:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
        >
          <span className={`flex min-w-0 items-center gap-2 ${selected ? 'pr-6' : 'text-neutral-400'}`}>
            <span className="truncate">{selected?.label ?? placeholder}</span>
            {selected?.badge && <StatusBadge status={selected.badge} />}
          </span>
          <ChevronDown className="size-4 shrink-0 text-neutral-500" />
        </Popover.Trigger>
        {selected && (
          <button
            aria-label="Clear"
            onClick={() => onValueChange('')}
            className="absolute top-1/2 right-8 flex size-6 -translate-y-1/2 items-center justify-center rounded text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-blue-700"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          className="z-50 flex max-h-[min(22rem,var(--radix-popover-content-available-height))] w-(--radix-popover-trigger-width) min-w-64 flex-col rounded-md border border-neutral-200 bg-white shadow-lg"
        >
          <div className="relative border-b border-neutral-200 p-2">
            <Search className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-neutral-400" />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls={`${id}-options`}
              aria-activedescendant={shown.length ? `${id}-option-${active}` : undefined}
              aria-label={`Search ${noun}`}
              placeholder={`Search ${noun}…`}
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
              className="block w-full rounded-md border border-neutral-300 py-1.5 pr-3 pl-8 text-sm outline-none placeholder:text-neutral-400 focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
            />
          </div>
          <div id={`${id}-options`} role="listbox" aria-label={noun} className="min-h-0 flex-1 overflow-y-auto p-1 text-sm">
            {shown.map((option, index) => (
              <button
                key={option.value}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={option.value === value}
                tabIndex={-1}
                onClick={() => choose(option.value)}
                onMouseMove={() => setActive(index)}
                className={`flex w-full items-center justify-between gap-3 rounded px-2 py-1.5 text-left ${index === active ? 'bg-neutral-100' : ''}`}
              >
                {/* the name with its tag on the first line, the quieter detail (an id) under it */}
                <span className="min-w-0">
                  <span className="flex min-w-0 items-start gap-2">
                    {/* long names (RedTrack campaigns, say) get a second line before they are cut */}
                    <span className="line-clamp-2 wrap-break-word">{option.label}</span>
                    {option.badge && <StatusBadge status={option.badge} />}
                  </span>
                  {option.detail && <span className="block truncate text-xs text-neutral-400 tabular-nums">{option.detail}</span>}
                </span>
                {option.value === value && <Check className="size-4 shrink-0 text-blue-700" />}
              </button>
            ))}
            {shown.length === 0 && <p className="px-2 py-3 text-neutral-500">{options.length ? 'Nothing matches.' : `No ${noun} to show.`}</p>}
            {matches.length > shown.length && (
              <p className="px-2 py-2 text-xs text-neutral-500">
                Showing {shown.length} of {matches.length.toLocaleString()}. Search to narrow the list.
              </p>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

export function Tip({ label, side, children }: { label: string; side?: 'top' | 'right' | 'bottom'; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 rounded-md bg-neutral-900 px-2 py-1 text-xs text-white shadow-md"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
