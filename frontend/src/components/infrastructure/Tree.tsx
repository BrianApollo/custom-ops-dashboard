import { ChevronRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { button } from '../ui'
import { KINDS, type BmNode, type Data, type Item, type Kind, type Tree as TreeData } from './model'
import { ItemButton } from './parts'

interface TreeProps {
  data: Data
  tree: TreeData
  selectedKey?: string
  onSelect: (key: string) => void
  // while searching, every branch that holds a match is open
  searching: boolean
}

export function Tree({ data, tree, selectedKey, onSelect, searching }: TreeProps) {
  // keyed by where the row sits, since a business manager can be under several profiles
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const isOpen = (path: string) => searching || !closed.has(path)
  const toggle = (path: string) =>
    setClosed((before) => {
      const next = new Set(before)
      if (!next.delete(path)) next.add(path)
      return next
    })

  const row = (item: Item) => <ItemButton data={data} item={item} selected={item.key === selectedKey} onSelect={onSelect} />

  // a row that opens to show what is under it
  const branch = (path: string, item: Item, children: ReactNode) => (
    <>
      <div className="flex items-center gap-1">
        <button
          onClick={() => toggle(path)}
          disabled={searching}
          aria-expanded={isOpen(path)}
          aria-label={`${isOpen(path) ? 'Collapse' : 'Expand'} ${item.name}`}
          className={`${button.icon} shrink-0`}
        >
          <ChevronRight className={`size-4 transition-transform ${isOpen(path) ? 'rotate-90' : ''}`} />
        </button>
        {row(item)}
      </div>
      {isOpen(path) && children}
    </>
  )

  const leaves = (kind: Kind, items: Item[]) =>
    items.length > 0 && (
      <div>
        <h4 className="px-2 text-xs font-medium tracking-wide text-neutral-500 uppercase">
          {KINDS[kind].plural} ({items.length})
        </h4>
        <ul className="mt-1 grid gap-x-3 gap-y-0.5 lg:grid-cols-2">
          {items.map((item) => (
            <li key={item.key} className="min-w-0">
              {row(item)}
            </li>
          ))}
        </ul>
      </div>
    )

  const bms = (parent: string, nodes: BmNode[]) =>
    nodes.length > 0 && (
      <div>
        <h4 className="px-2 text-xs font-medium tracking-wide text-neutral-500 uppercase">Business Managers ({nodes.length})</h4>
        <ul className="mt-1 space-y-1">
          {nodes.map((node) => (
            <li key={node.item.key}>
              {branch(
                `${parent}/${node.item.key}`,
                node.item,
                node.adAccounts.length + node.pixels.length > 0 ? (
                  <div className="mt-1 mb-2 ml-4 space-y-3 border-l border-neutral-200 pl-5">
                    {leaves('adAccount', node.adAccounts)}
                    {leaves('pixel', node.pixels)}
                  </div>
                ) : (
                  <p className="mb-2 ml-11 text-xs text-neutral-500">No ad accounts or pixels to show.</p>
                ),
              )}
            </li>
          ))}
        </ul>
      </div>
    )

  const { unlinked } = tree
  const unlinkedCount = unlinked.bms.length + unlinked.adAccounts.length + unlinked.pixels.length + unlinked.pages.length

  return (
    <div className="space-y-3">
      {tree.profiles.map((node) => (
        <section key={node.item.key} aria-label={`Profile ${node.item.name}`} className="rounded-lg border border-neutral-200 bg-white p-2">
          {branch(
            node.item.key,
            node.item,
            node.bms.length + node.pages.length > 0 ? (
              <div className="mt-2 space-y-4 border-t border-neutral-200 px-1 pt-3 pb-1">
                {bms(node.item.key, node.bms)}
                {leaves('page', node.pages)}
              </div>
            ) : (
              <p className="mt-2 border-t border-neutral-200 px-3 pt-3 pb-1 text-xs text-neutral-500">
                Nothing is linked to this profile. Syncing it from Facebook fills this in.
              </p>
            ),
          )}
        </section>
      ))}

      {unlinkedCount > 0 && (
        <section aria-labelledby="infra-unlinked" className="rounded-lg border border-dashed border-neutral-300 bg-white p-3">
          <h3 id="infra-unlinked" className="px-2 text-sm font-semibold">
            Not linked to a profile ({unlinkedCount})
          </h3>
          <p className="mt-0.5 px-2 text-xs text-neutral-500">Records that no profile or Business Manager leads to.</p>
          <div className="mt-3 space-y-4">
            {bms('unlinked', unlinked.bms)}
            {leaves('adAccount', unlinked.adAccounts)}
            {leaves('pixel', unlinked.pixels)}
            {leaves('page', unlinked.pages)}
          </div>
        </section>
      )}
    </div>
  )
}
