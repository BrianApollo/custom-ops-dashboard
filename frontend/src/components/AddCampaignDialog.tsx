import { Dialog, Label } from 'radix-ui'
import { useState, type FormEvent } from 'react'
import type { Product } from '../data'
import { api, type ApiRecord } from '../lib/api'
import { button, input } from './ui'

interface Props {
  product: Product
  onClose: () => void
  // called with the new campaign's id
  onCreated: (id: string) => void
}

// A campaign starts as a name under a product, in Preparing; everything else is set in the launcher
export function AddCampaignDialog({ product, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const record = await api<ApiRecord>('/data/campaigns', {
        method: 'POST',
        body: { fields: { Name: name.trim(), Product: [product.id], Status: 'Preparing' } },
      })
      onCreated(record.id)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl">
          <Dialog.Title className="text-base font-semibold">Add campaign</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-neutral-600">
            For {product.name}. It opens in the launcher, where the rest is set up.
          </Dialog.Description>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <Label.Root htmlFor="new-campaign-name" className="text-sm font-medium">
                Campaign name
              </Label.Root>
              <input
                id="new-campaign-name"
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`${input} mt-1.5`}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close type="button" className={button.secondary}>
                Cancel
              </Dialog.Close>
              <button type="submit" disabled={busy || !name.trim()} className={button.primary}>
                {busy ? 'Creating…' : 'Create and open'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
