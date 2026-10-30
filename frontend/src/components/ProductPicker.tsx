import { Check, ChevronDown, Package, Plus, Search } from 'lucide-react'
import { Popover } from 'radix-ui'
import { useState, type KeyboardEvent } from 'react'
import type { Product } from '../data'
import { matchesSearch } from '../lib/search'
import { StatusBadge } from './ui'

// Active products first, then the other statuses alphabetically
function groupByStatus(products: Product[]) {
  const groups = new Map<string, Product[]>()
  for (const product of products) {
    const status = product.status || 'No status'
    groups.set(status, [...(groups.get(status) ?? []), product])
  }
  return [...groups].sort(([a], [b]) => Number(b === 'Active') - Number(a === 'Active') || a.localeCompare(b))
}

export function ProductLogo({ product, className = 'size-6' }: { product?: Product; className?: string }) {
  return product?.logo ? (
    <img src={product.logo} alt="" className={`${className} shrink-0 rounded object-contain`} />
  ) : (
    <span className={`${className} flex shrink-0 items-center justify-center rounded bg-neutral-100 text-neutral-500`}>
      <Package className="size-3.5" />
    </span>
  )
}

interface Props {
  products: Product[]
  selected?: Product
  onSelect: (id: string | null) => void
  // shown only to people who may create products
  onCreate?: () => void
}

export function ProductPicker({ products, selected, onSelect, onCreate }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [active, setActive] = useState(0)

  const term = search.trim().toLowerCase()
  const groups = groupByStatus(products.filter((product) => matchesSearch(term, product.name)))
  // the keyboard moves through one flat list: "All Products", then every product in display order
  const options: (Product | null)[] = [null, ...groups.flatMap(([, items]) => items)]

  function choose(product: Product | null) {
    onSelect(product?.id ?? null)
    setOpen(false)
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const next = (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length
      setActive(next)
      document.getElementById(`product-option-${next}`)?.scrollIntoView({ block: 'nearest' })
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(options[Math.min(active, options.length - 1)])
    }
  }

  const option = (product: Product | null) => {
    const index = options.indexOf(product)
    const isSelected = (product?.id ?? null) === (selected?.id ?? null)
    return (
      <button
        key={product?.id ?? 'all'}
        id={`product-option-${index}`}
        role="option"
        aria-selected={isSelected}
        tabIndex={-1}
        onClick={() => choose(product)}
        onMouseMove={() => setActive(index)}
        className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm ${index === active ? 'bg-neutral-100' : ''}`}
      >
        {product ? <ProductLogo product={product} /> : null}
        <span className={`min-w-0 flex-1 truncate ${isSelected ? 'font-semibold' : ''}`}>
          {product?.name ?? 'All Products'}
        </span>
        {isSelected && <Check className="size-4 shrink-0 text-blue-700" />}
      </button>
    )
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
      <Popover.Trigger className="inline-flex h-10 max-w-full items-center gap-2 rounded-md border border-neutral-300 bg-white pr-2.5 pl-3 text-sm font-semibold hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
        {selected && <ProductLogo product={selected} />}
        <span className="truncate">{selected?.name ?? 'All Products'}</span>
        {selected && <StatusBadge status={selected.status} />}
        <ChevronDown className="size-4 shrink-0 text-neutral-500" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 flex max-h-[min(26rem,var(--radix-popover-content-available-height))] w-72 flex-col rounded-lg border border-neutral-200 bg-white shadow-lg"
        >
          <div className="relative border-b border-neutral-200 p-2">
            <Search className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-neutral-400" />
            <input
              autoFocus
              role="combobox"
              aria-expanded
              aria-controls="product-options"
              aria-activedescendant={`product-option-${active}`}
              aria-label="Search products"
              placeholder="Search products…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setActive(0)
              }}
              onKeyDown={onKeyDown}
              className="block w-full rounded-md border border-neutral-300 py-1.5 pr-3 pl-8 text-sm outline-none placeholder:text-neutral-400 focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
            />
          </div>

          <div id="product-options" role="listbox" aria-label="Products" className="min-h-0 flex-1 overflow-y-auto p-1">
            {option(null)}
            {groups.map(([status, items]) => (
              <div key={status} role="group" aria-label={status}>
                <div className="px-2 pt-3 pb-1 text-xs font-medium tracking-wide text-neutral-500 uppercase">
                  {status} <span className="text-neutral-400">{items.length}</span>
                </div>
                {items.map(option)}
              </div>
            ))}
            {term && options.length === 1 && (
              <p className="px-2 py-3 text-sm text-neutral-500">No product matches “{search.trim()}”.</p>
            )}
          </div>

          {onCreate && (
            <div className="border-t border-neutral-200 p-1">
              <button
                onClick={() => {
                  setOpen(false)
                  onCreate()
                }}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-700"
              >
                <Plus className="size-4" />
                Create new product
              </button>
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
