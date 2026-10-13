import { Search } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useState } from 'react'
import { button, StatusBadge } from '../../components/ui'
import { text, type ApiRecord } from '../../lib/api'

interface Props {
  // launched campaigns of the same product, newest first; undefined while loading
  candidates?: ApiRecord[]
  error?: string
  onClose: () => void
  onClone: (source: ApiRecord) => void
}

const links = (record: ApiRecord, field: string) => ((record.fields[field] as string[] | undefined) ?? []).length

// when the campaign went out, as a date
export const launchedOn = (record: ApiRecord) => (text(record, 'Launched At') || record.createdTime).slice(0, 10)

// Picks an earlier campaign of this product to copy the setup and media selection from
export function CloneDialog({ candidates, error, onClose, onClone }: Props) {
  const [search, setSearch] = useState('')
  const [chosen, setChosen] = useState<string>()
  const term = search.trim().toLowerCase()
  const shown = (candidates ?? []).filter((record) =>
    ['Name', 'RedTrack Campaign Name', 'Ad Acc Used', 'FB Ad Account ID'].some((field) => text(record, field).toLowerCase().includes(term)),
  )
  const source = shown.find((record) => record.id === chosen)

  let empty = ''
  if (error) empty = `Could not load campaigns: ${error}`
  else if (!candidates) empty = 'Loading…'
  else if (!candidates.length) empty = 'No launched campaigns for this product yet.'
  else if (!shown.length) empty = `No campaigns match “${search.trim()}”.`

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-white p-6 shadow-xl">
          <Dialog.Title className="text-base font-semibold">Clone a launched campaign</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-neutral-600">
            Copies its token, ad account, page, pixel, budget, countries, RedTrack campaign, links, start time of day and creatives. This campaign keeps its
            own name, start date and “launch as active” choice.
          </Dialog.Description>

          <div className="relative mt-4">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="search"
              autoFocus
              aria-label="Search campaigns"
              placeholder="Search by campaign, RedTrack campaign or ad account…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="block h-9 w-full rounded-md border border-neutral-300 bg-white pr-2 pl-8 text-sm outline-none placeholder:text-neutral-400 focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
            />
          </div>

          <ul role="listbox" aria-label="Launched campaigns" className="mt-3 min-h-24 flex-1 divide-y divide-neutral-100 overflow-y-auto rounded-md border border-neutral-200">
            {shown.map((record) => (
              <li key={record.id} role="option" aria-selected={record.id === chosen}>
                <button
                  type="button"
                  onClick={() => setChosen(record.id)}
                  onDoubleClick={() => onClone(record)}
                  className={`block w-full px-3 py-2.5 text-left text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-700 ${record.id === chosen ? 'bg-blue-50' : 'hover:bg-neutral-50'}`}
                >
                  <span className="flex items-center gap-2">
                    <span className="min-w-0 truncate font-medium">{text(record, 'Name') || 'Untitled'}</span>
                    {/* a campaign paused from its own page is stored as Cancelled */}
                    {text(record, 'Status') === 'Cancelled' && <StatusBadge status="Paused" />}
                    <span className="ml-auto shrink-0 text-xs text-neutral-500">Launched {launchedOn(record)}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-neutral-600">
                    {[
                      text(record, 'RedTrack Campaign Name') && `RedTrack: ${text(record, 'RedTrack Campaign Name')}`,
                      `${links(record, 'Videos Used In This Campaign') + links(record, 'Videos copy')} videos`,
                      `${links(record, 'Images Used In This Campaign')} images`,
                      text(record, 'Ad Acc Used') || text(record, 'FB Ad Account ID'),
                      text(record, 'Budget') && `${text(record, 'Budget')}/day`,
                      text(record, 'Location Targeting'),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            ))}
            {empty && <li className={`px-3 py-8 text-center text-sm ${error ? 'text-red-700' : 'text-neutral-500'}`}>{empty}</li>}
          </ul>

          {source && <p className="mt-3 text-sm text-amber-800">This replaces the current setup and media selection.</p>}
          <div className="mt-5 flex justify-end gap-2">
            <Dialog.Close type="button" className={button.secondary}>
              Cancel
            </Dialog.Close>
            <button type="button" disabled={!source} onClick={() => source && onClone(source)} className={button.primary}>
              Clone
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
