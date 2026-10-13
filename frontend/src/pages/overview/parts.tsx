import { CircleCheck, CircleX } from 'lucide-react'
import { ToggleGroup, Tooltip } from 'radix-ui'
import type { ReactNode } from 'react'

// Pieces shared by the Video Editors and Scripts tabs

// Dates arrive as plain calendar days (YYYY-MM-DD), already in the team's time
// zone, so they are read as UTC to keep the viewer's own zone from shifting them.
const utc = (date: string) => new Date(`${date}T00:00:00Z`)
const format = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(utc(date))

export const addDays = (date: string, days: number) => new Date(utc(date).getTime() + days * 86_400_000).toISOString().slice(0, 10)
// 2026-03 -> March 2026
export const monthLabel = (key: string) => format(`${key}-01`, { month: 'long', year: 'numeric' })
// Tue, Mar 3
export const dayLabel = (date: string) => format(date, { weekday: 'short', month: 'short', day: 'numeric' })
export const weekdayLabel = (date: string) => format(date, { weekday: 'short' })
// Mar 30 – Apr 5
export const rangeLabel = (from: string, to: string) =>
  `${format(from, { month: 'short', day: 'numeric' })} – ${format(to, { month: 'short', day: 'numeric' })}`

export const plural = (count: number, noun: string) => `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`

const segment =
  'px-3 py-1.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-blue-700 data-[state=on]:bg-blue-50 data-[state=on]:text-blue-800'

interface SegmentedProps<V extends string> {
  label: string
  value: V
  options: { value: V; label: string }[]
  onValueChange: (value: V) => void
}

// Two choices side by side, exactly one of them on
export function Segmented<V extends string>({ label, value, options, onValueChange }: SegmentedProps<V>) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      // clicking the chosen one again leaves it chosen
      onValueChange={(next) => next && onValueChange(next as V)}
      className="flex divide-x divide-neutral-300 overflow-hidden rounded-md border border-neutral-300 bg-white"
    >
      {options.map((option) => (
        <ToggleGroup.Item key={option.value} value={option.value} className={segment}>
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  )
}

const chip = 'inline-flex rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums ring-1 ring-inset'
export const tone = {
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  red: 'bg-red-50 text-red-800 ring-red-600/20',
  blue: 'bg-blue-50 text-blue-800 ring-blue-600/20',
}

export function Chip({ color, children }: { color: keyof typeof tone; children: ReactNode }) {
  return <span className={`${chip} ${tone[color]}`}>{children}</span>
}

// How far behind target: `-2` behind, `On Target` when exact, `+2` ahead
export function DeficitChip({ deficit }: { deficit: number }) {
  if (deficit > 0) return <Chip color="red">-{deficit}</Chip>
  return <Chip color="green">{deficit === 0 ? 'On Target' : `+${-deficit}`}</Chip>
}

export function PassIcon({ passed }: { passed: boolean }) {
  return passed ? (
    <CircleCheck aria-label="Target met" className="size-4 shrink-0 text-emerald-600" />
  ) : (
    <CircleX aria-label="Target missed" className="size-4 shrink-0 text-red-600" />
  )
}

// A tooltip that holds more than one line; `Tip` in components/ui takes plain text only
export function RichTip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content sideOffset={6} className="z-50 rounded-md bg-neutral-900 px-3 py-2 text-xs text-white shadow-md">
          {content}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
