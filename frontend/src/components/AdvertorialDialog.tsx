import { Pencil, X } from 'lucide-react'
import { Dialog, Label } from 'radix-ui'
import { useState, type FormEvent } from 'react'
import type { Product } from '../data'
import { api, text, type ApiRecord } from '../lib/api'
import { button, input, StatusBadge } from './ui'

interface Props {
  // the advertorial to show or edit; none when adding one
  record?: ApiRecord
  // the product a new advertorial belongs to
  product?: Product
  // open straight in the form instead of the read-only view
  editing: boolean
  // approved advertorials are read-only, as are all of them for people who cannot edit
  canEdit: boolean
  onClose: () => void
  onSaved: () => void
}

// One advertorial: read it in full, or edit it in the same dialog. Also the form for adding one.
export function AdvertorialDialog({ record, product, canEdit, onClose, onSaved, ...props }: Props) {
  const [editing, setEditing] = useState(props.editing)
  const [name, setName] = useState(record ? text(record, 'Advertorial Name') : '')
  const [body, setBody] = useState(record ? text(record, 'Advertorial Text') : '')
  const [link, setLink] = useState(record ? text(record, 'Final Advertorial Link') : '')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    const fields = { 'Advertorial Name': name.trim(), 'Advertorial Text': body, 'Final Advertorial Link': link.trim() }
    try {
      if (record) await api(`/data/advertorials/${record.id}`, { method: 'PATCH', body: { fields } })
      else await api('/data/advertorials', { method: 'POST', body: { fields: { ...fields, Product: [product!.id] } } })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const approved = Boolean(record?.fields['Advertorial Checked'])
  const savedLink = record ? text(record, 'Final Advertorial Link') : ''

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-white shadow-xl"
        >
          <div className="flex items-center gap-3 border-b border-neutral-200 px-6 py-4">
            <Dialog.Title className="min-w-0 flex-1 truncate text-base font-semibold">
              {!record ? `Add advertorial for ${product?.name}` : editing ? 'Edit advertorial' : text(record, 'Advertorial Name') || 'Untitled'}
            </Dialog.Title>
            {record && <StatusBadge status={approved ? 'Approved' : 'Pending'} />}
            <Dialog.Close aria-label="Close" className={button.icon}>
              <X className="size-4" />
            </Dialog.Close>
          </div>

          {editing ? (
            <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
                <div>
                  <Label.Root htmlFor="advertorial-name" className="text-sm font-medium">
                    Name
                  </Label.Root>
                  <input
                    id="advertorial-name"
                    required
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={`${input} mt-1.5`}
                  />
                </div>
                <div>
                  <Label.Root htmlFor="advertorial-link" className="text-sm font-medium">
                    Final advertorial link
                  </Label.Root>
                  <input
                    id="advertorial-link"
                    type="url"
                    placeholder="https://"
                    value={link}
                    onChange={(e) => setLink(e.target.value)}
                    className={`${input} mt-1.5`}
                  />
                </div>
                <div>
                  <Label.Root htmlFor="advertorial-text" className="text-sm font-medium">
                    Advertorial text
                  </Label.Root>
                  <textarea
                    id="advertorial-text"
                    rows={12}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    className={`${input} mt-1.5 resize-y leading-relaxed`}
                  />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-red-700">
                    {error}
                  </p>
                )}
              </div>
              <div className="flex justify-end gap-2 border-t border-neutral-200 px-6 py-3">
                <Dialog.Close type="button" className={button.secondary}>
                  Cancel
                </Dialog.Close>
                <button type="submit" disabled={busy || !name.trim()} className={button.primary}>
                  {busy ? 'Saving…' : record ? 'Save changes' : 'Add advertorial'}
                </button>
              </div>
            </form>
          ) : (
            <>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4 text-sm">
                {savedLink && (
                  <a href={savedLink} target="_blank" rel="noreferrer" className="block break-all text-blue-700 underline-offset-2 hover:underline">
                    {savedLink}
                  </a>
                )}
                {body ? (
                  <p className="leading-relaxed whitespace-pre-wrap text-neutral-800">{body}</p>
                ) : (
                  <p className="text-neutral-500">This advertorial has no text yet.</p>
                )}
              </div>
              {canEdit && (
                <div className="flex justify-end border-t border-neutral-200 px-6 py-3">
                  <button onClick={() => setEditing(true)} className={button.secondary}>
                    <Pencil className="size-4" />
                    Edit
                  </button>
                </div>
              )}
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
