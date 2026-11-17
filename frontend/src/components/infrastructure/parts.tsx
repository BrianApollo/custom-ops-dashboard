import type { ReactNode } from 'react'
import { badgesFor, KINDS, ownerOf, type Data, type Item, type Tone } from './model'
import { ItemMenu } from './ItemMenu'

// the same tones as StatusBadge in ui.tsx, which picks its tone from a fixed list of statuses
const TONES: Record<Tone, string> = {
  blue: 'bg-blue-50 text-blue-800 ring-blue-600/20',
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-600/20',
  amber: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  red: 'bg-red-50 text-red-800 ring-red-600/20',
  neutral: 'bg-neutral-100 text-neutral-700 ring-neutral-500/20',
}

export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${TONES[tone]}`}>{children}</span>
}

export function ItemBadges({ data, item }: { data: Data; item: Item }) {
  return (
    <>
      {badgesFor(data, item).map((badge) => (
        <Badge key={badge.label} tone={badge.tone}>
          {badge.label}
        </Badge>
      ))}
    </>
  )
}

interface ItemButtonProps {
  data: Data
  item: Item
  selected?: boolean
  onSelect: (key: string) => void
  // what a click does, said to screen readers
  clickLabel?: string
}

// One record as a row: icon, name, Facebook id (and an ad account's owner) and badges.
// A click does what the list it sits in says; a right-click opens its menu.
export function ItemButton({ data, item, selected, onSelect, clickLabel = 'open details' }: ItemButtonProps) {
  const Icon = KINDS[item.kind].icon
  const owner = item.kind === 'adAccount' ? ownerOf(data, item) : undefined
  return (
    <ItemMenu item={item}>
      <button
        onClick={() => onSelect(item.key)}
        aria-label={`${KINDS[item.kind].label} ${item.name}, ${clickLabel}`}
        aria-pressed={selected}
        className={`flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-blue-700 ${selected ? 'bg-blue-50 ring-1 ring-blue-700' : ''}`}
      >
        <Icon className={`size-4 shrink-0 text-neutral-500 ${item.hidden ? 'opacity-50' : ''}`} />
        <span className={`min-w-0 flex-1 ${item.hidden ? 'opacity-60' : ''}`}>
          <span className="block truncate font-medium">{item.name}</span>
          <span className="block truncate text-xs text-neutral-500 tabular-nums">
            {item.fbId || 'No Facebook id'}
            {owner && ` · owned by ${owner.name}`}
          </span>
        </span>
        <span className="flex max-w-[55%] shrink-0 flex-wrap justify-end gap-1">
          <ItemBadges data={data} item={item} />
        </span>
      </button>
    </ItemMenu>
  )
}
