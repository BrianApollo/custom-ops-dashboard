import { X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { api, ApiError, type ApiRecord } from '../lib/api'
import { button } from './ui'

// Long machine-written values (launch payloads) would swamp the dialog
const MAX_TEXT = 300

function display(value: unknown): string | null {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return value.toLocaleString()
  if (typeof value === 'string') return value.length > MAX_TEXT ? null : value
  // links and attachments: the count is what fits here
  if (Array.isArray(value)) return `${value.length} linked`
  return null
}

interface Props {
  // e.g. `campaigns`
  table: string
  // the record to show; null closes the dialog
  record: { id: string; title: string } | null
  onClose: () => void
}

// Every field of one record, read-only
export function RecordDialog({ table, record, onClose }: Props) {
  const { expire } = useAuth()
  const [loaded, setLoaded] = useState<ApiRecord>()
  const [error, setError] = useState<string>()
  const id = record?.id

  useEffect(() => {
    if (!id) return
    let stale = false
    setLoaded(undefined)
    setError(undefined)
    api<ApiRecord>(`/data/${table}/${id}`)
      .then((res) => !stale && setLoaded(res))
      .catch((err: Error) => {
        if (stale) return
        if (err instanceof ApiError && err.status === 401) expire()
        else setError(err.message)
      })
    return () => {
      stale = true
    }
  }, [table, id, expire])

  const rows = Object.entries(loaded?.fields ?? {}).flatMap(([name, value]) => {
    const shown = display(value)
    return shown === null ? [] : [{ name, shown }]
  })

  return (
    <Dialog.Root open={record !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-white shadow-xl"
        >
          <div className="flex items-center justify-between gap-4 border-b border-neutral-200 px-6 py-4">
            <Dialog.Title className="truncate text-base font-semibold">{record?.title}</Dialog.Title>
            <Dialog.Close aria-label="Close" className={button.icon}>
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {error && <p className="text-sm text-red-700">Could not load this record: {error}</p>}
            {!error && !loaded && <p className="text-sm text-neutral-500">Loading…</p>}
            {loaded && (
              <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-2.5 text-sm">
                {rows.map(({ name, shown }) => (
                  <div key={name} className="contents">
                    <dt className="text-neutral-500">{name}</dt>
                    <dd className="break-words">{shown}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
