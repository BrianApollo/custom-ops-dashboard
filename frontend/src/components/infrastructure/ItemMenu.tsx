import { Copy, Eye, EyeOff, Info, RefreshCw } from 'lucide-react'
import { ContextMenu } from 'radix-ui'
import { createContext, useContext, type ReactNode } from 'react'
import { KINDS, type Item } from './model'

// What the page lets you do with a record from its right-click menu
export interface ItemActions {
  openDetails: (key: string) => void
  // opens the details and starts a sync there, so its result shows
  sync: (key: string) => void
  toggleHidden: (item: Item) => void
}

const ActionsContext = createContext<ItemActions | undefined>(undefined)
export const ItemActionsProvider = ActionsContext.Provider

const itemClass =
  'flex cursor-default items-center gap-2 rounded px-2 py-1.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-neutral-100'

// A right-click (or the keyboard's menu key) on a record: More info and a few quick actions.
// The trigger is the child itself, so it keeps its own look and click.
export function ItemMenu({ item, children }: { item: Item; children: ReactNode }) {
  const actions = useContext(ActionsContext)
  if (!actions) return <>{children}</>
  const hasToken = Boolean(item.record.fields.hasToken)
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="z-[60] min-w-48 rounded-md border border-neutral-200 bg-white p-1 shadow-lg">
          <ContextMenu.Label className="truncate px-2 py-1 text-xs text-neutral-500">
            {KINDS[item.kind].label} · {item.name}
          </ContextMenu.Label>
          <ContextMenu.Item className={itemClass} onSelect={() => actions.openDetails(item.key)}>
            <Info className="size-4 text-neutral-500" />
            More info
          </ContextMenu.Item>
          {item.kind === 'profile' && (
            <ContextMenu.Item className={itemClass} disabled={!hasToken} onSelect={() => actions.sync(item.key)}>
              <RefreshCw className="size-4 text-neutral-500" />
              {hasToken ? 'Sync from Facebook' : 'Sync (no token stored)'}
            </ContextMenu.Item>
          )}
          <ContextMenu.Item className={itemClass} disabled={!item.fbId} onSelect={() => void navigator.clipboard.writeText(item.fbId)}>
            <Copy className="size-4 text-neutral-500" />
            Copy Facebook ID
          </ContextMenu.Item>
          <ContextMenu.Separator className="my-1 h-px bg-neutral-200" />
          <ContextMenu.Item className={itemClass} onSelect={() => actions.toggleHidden(item)}>
            {item.hidden ? <Eye className="size-4 text-neutral-500" /> : <EyeOff className="size-4 text-neutral-500" />}
            {item.hidden ? 'Unhide' : 'Hide'}
          </ContextMenu.Item>
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
