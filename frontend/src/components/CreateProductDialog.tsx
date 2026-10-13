import { Dialog, Label } from 'radix-ui'
import { useState, type FormEvent } from 'react'
import { api, type ApiRecord } from '../lib/api'
import { button, input, Select } from './ui'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  // statuses already in use, so a new product lands in an existing group
  statuses: string[]
  onCreated: (id: string) => void
}

export function CreateProductDialog({ open, onOpenChange, statuses, onCreated }: Props) {
  const options = statuses.length ? statuses : ['Active']
  const [name, setName] = useState('')
  const [status, setStatus] = useState(options[0])
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const record = await api<ApiRecord>('/data/products', {
        method: 'POST',
        body: { fields: { 'Product Name': name.trim(), Status: status } },
      })
      setName('')
      onCreated(record.id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl">
          <Dialog.Title className="text-base font-semibold">Create product</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-neutral-600">
            Logo and other details can be added afterwards.
          </Dialog.Description>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <Label.Root htmlFor="product-name" className="text-sm font-medium">
                Name
              </Label.Root>
              <input
                id="product-name"
                required
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={`${input} mt-1.5`}
              />
            </div>
            <div>
              <Label.Root htmlFor="product-status" className="text-sm font-medium">
                Status
              </Label.Root>
              <Select
                id="product-status"
                value={status}
                options={options}
                onValueChange={setStatus}
                className="mt-1.5 h-9.5 w-full"
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
                {busy ? 'Creating…' : 'Create product'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
