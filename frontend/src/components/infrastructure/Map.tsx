import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { matchesSearch } from '../../lib/search'
import { KINDS, linked, statusTone, type Data, type Item, type Kind, type Tone } from './model'
import { Badge } from './parts'

interface Props {
  data: Data
  search: string
  showHidden: boolean
  selectedKey?: string
  onSelect: (key: string) => void
}

// which side of each card a line leaves from: side links run left to right, the others top to bottom
type Flow = 'across' | 'down'
interface Edge {
  from: string
  to: string
  flow: Flow
}
interface Line extends Edge {
  path: string
}

const EDGE_TONE: Record<Tone, string> = {
  green: 'border-l-emerald-500',
  amber: 'border-l-amber-500',
  red: 'border-l-red-500',
  blue: 'border-l-blue-500',
  neutral: 'border-l-neutral-300',
}

// How far down the chain each kind sits; a card's key starts with its kind (`profile:rec…`)
const LAYER: Record<Kind, number> = { page: 0, profile: 1, bm: 2, adAccount: 3, pixel: 3 }
const layer = (key: string) => LAYER[key.slice(0, key.indexOf(':')) as Kind]

const GROUP_TONE: Record<Kind, string> = {
  adAccount: 'border-t-emerald-500',
  page: 'border-t-amber-500',
  profile: 'border-t-violet-500',
  bm: 'border-t-blue-500',
  pixel: 'border-t-pink-500',
}

// The whole setup as one picture: ad accounts on the left, pixels on the right, and pages,
// profiles and business managers down the middle, with a line for every link between them.
// Pointing at a card picks out what it is connected to.
export function Map({ data, search, showHidden, selectedKey, onSelect }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const cards = useRef(new globalThis.Map<string, HTMLElement>())
  const [lines, setLines] = useState<Line[]>([])
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [pointed, setPointed] = useState<string>()

  const term = search.trim().toLowerCase()
  const { shown, edges } = useMemo(() => {
    const visible = (items: Item[]) => items.filter((item) => (showHidden || !item.hidden) && matchesSearch(term, item.haystack))
    const shown: Record<Kind, Item[]> = {
      adAccount: visible(data.adAccounts),
      page: visible(data.pages),
      profile: visible(data.profiles),
      bm: visible(data.bms),
      pixel: visible(data.pixels),
    }
    const keys = new Set(Object.values(shown).flatMap((items) => items.map((item) => item.key)))
    const edges: Edge[] = []
    const link = (from: Item, to: Item, flow: Flow) => keys.has(from.key) && keys.has(to.key) && edges.push({ from: from.key, to: to.key, flow })
    for (const profile of shown.profile) {
      for (const page of linked(data, profile, 'page')) link(page, profile, 'down')
      for (const bm of linked(data, profile, 'bm')) link(profile, bm, 'down')
    }
    for (const bm of shown.bm) {
      for (const account of linked(data, bm, 'adAccount')) link(account, bm, 'across')
      for (const pixel of linked(data, bm, 'pixel')) link(bm, pixel, 'across')
    }
    return { shown, edges }
  }, [data, term, showHidden])

  // The lines are drawn from where the cards actually ended up, so they are measured
  // after every layout and again whenever the picture changes size.
  useLayoutEffect(() => {
    const box = container.current
    if (!box) return
    function measure() {
      const frame = box!.getBoundingClientRect()
      const at = (key: string) => {
        const card = cards.current.get(key)
        if (!card) return undefined
        const rect = card.getBoundingClientRect()
        return { left: rect.left - frame.left, right: rect.right - frame.left, top: rect.top - frame.top, bottom: rect.bottom - frame.top }
      }
      setSize({ width: box!.scrollWidth, height: box!.scrollHeight })
      setLines(
        edges.flatMap((edge) => {
          const a = at(edge.from)
          const b = at(edge.to)
          if (!a || !b) return []
          if (edge.flow === 'across') {
            const [x1, y1, x2, y2] = [a.right, (a.top + a.bottom) / 2, b.left, (b.top + b.bottom) / 2]
            const bend = (x1 + x2) / 2
            return [{ ...edge, path: `M ${x1} ${y1} C ${bend} ${y1}, ${bend} ${y2}, ${x2} ${y2}` }]
          }
          const [x1, y1, x2, y2] = [(a.left + a.right) / 2, a.bottom, (b.left + b.right) / 2, b.top]
          const bend = (y1 + y2) / 2
          return [{ ...edge, path: `M ${x1} ${y1} C ${x1} ${bend}, ${x2} ${bend}, ${x2} ${y2}` }]
        }),
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(box)
    return () => observer.disconnect()
  }, [edges])

  // the card being pointed at, or failing that the one whose details are open
  const focus = pointed ?? selectedKey
  // Everything the focused card reaches through the chain page → profile → business manager →
  // ad account or pixel, in both directions but never doubling back: a profile picks out its
  // pages, its business managers and every ad account and pixel those hold; an ad account picks
  // out the business managers holding it, the profiles with access to them, and their pages.
  const related = useMemo(() => {
    if (!focus) return undefined
    const neighbours = new globalThis.Map<string, string[]>()
    for (const edge of edges) {
      neighbours.set(edge.from, [...(neighbours.get(edge.from) ?? []), edge.to])
      neighbours.set(edge.to, [...(neighbours.get(edge.to) ?? []), edge.from])
    }
    const keys = new Set([focus])
    for (const direction of [1, -1]) {
      let frontier = [focus]
      while (frontier.length) {
        const next: string[] = []
        for (const key of frontier) {
          for (const other of neighbours.get(key) ?? []) {
            if (Math.sign(layer(other) - layer(key)) !== direction || keys.has(other)) continue
            keys.add(other)
            next.push(other)
          }
        }
        frontier = next
      }
    }
    return keys
  }, [focus, edges])

  function card(item: Item) {
    const Icon = KINDS[item.kind].icon
    const dimmed = related && !related.has(item.key)
    return (
      <button
        key={item.key}
        ref={(element) => {
          if (element) cards.current.set(item.key, element)
          else cards.current.delete(item.key)
        }}
        onClick={() => onSelect(item.key)}
        onMouseEnter={() => setPointed(item.key)}
        onMouseLeave={() => setPointed(undefined)}
        onFocus={() => setPointed(item.key)}
        onBlur={() => setPointed(undefined)}
        aria-label={`${KINDS[item.kind].label} ${item.name}, open details`}
        className={`flex w-32 flex-col items-center gap-1 rounded-md border border-l-4 border-neutral-200 bg-white px-2 py-2 text-center text-xs shadow-sm transition-opacity hover:border-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${EDGE_TONE[item.status ? statusTone(item.status) : 'neutral']} ${selectedKey === item.key ? 'ring-2 ring-blue-700' : ''} ${dimmed ? 'opacity-30' : ''} ${item.hidden ? 'border-dashed' : ''}`}
      >
        <Icon className="size-4 text-neutral-500" />
        <span className="w-full truncate font-medium" title={item.name}>
          {item.name}
        </span>
        {item.status && <Badge tone={statusTone(item.status)}>{item.status}</Badge>}
      </button>
    )
  }

  function group(kind: Kind, layout: string) {
    return (
      <section className={`rounded-lg border border-t-4 border-neutral-200 p-3 ${GROUP_TONE[kind]}`}>
        <h2 className="mb-3 text-xs font-semibold tracking-wide text-neutral-600 uppercase">
          {KINDS[kind].plural} <span className="font-normal text-neutral-400">({shown[kind].length})</span>
        </h2>
        {shown[kind].length ? (
          <div className={layout}>{shown[kind].map(card)}</div>
        ) : (
          <p className="w-32 text-center text-xs text-neutral-400">None</p>
        )}
      </section>
    )
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-200 bg-neutral-50/60">
      <div ref={container} className="relative grid min-w-[64rem] grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-24 p-6">
        {/* the lines sit under the cards and take no clicks */}
        <svg width={size.width} height={size.height} className="pointer-events-none absolute top-0 left-0" aria-hidden>
          {lines.map((line) => {
            // every line of the focused card's chain, not only the ones touching the card
            const lit = related !== undefined && related.has(line.from) && related.has(line.to)
            return (
              <path
                key={`${line.from}>${line.to}`}
                d={line.path}
                fill="none"
                strokeWidth={lit ? 2 : 1}
                className={lit ? 'stroke-blue-600' : focus ? 'stroke-neutral-200' : 'stroke-neutral-300'}
              />
            )
          })}
        </svg>

        <div className="relative">{group('adAccount', 'flex flex-col gap-2')}</div>
        <div className="relative flex flex-col items-center gap-14">
          {group('page', 'flex flex-wrap justify-center gap-2')}
          {group('profile', 'flex flex-wrap justify-center gap-2')}
          {group('bm', 'flex flex-col gap-2')}
        </div>
        <div className="relative">{group('pixel', 'flex flex-col gap-2')}</div>
      </div>
    </div>
  )
}
