import { Dialog, Label } from 'radix-ui'
import { useState, type FormEvent } from 'react'
import { api, type ApiRecord } from '../../lib/api'
import { button, input } from '../ui'

interface Props {
  onClose: () => void
  // called with the new profile's record id
  onCreated: (id: string) => void
}

// A profile starts as a name, and an email and Facebook id when they are already known;
// everything else is filled in box by box afterwards.
export function NewProfileDialog({ onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [facebookId, setFacebookId] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const fields: Record<string, string> = { 'Profile Name': name.trim() }
      if (email.trim()) fields['Profile Email'] = email.trim()
      if (facebookId.trim()) fields['Profile ID'] = facebookId.trim()
      const record = await api<ApiRecord>('/data/profiles', { method: 'POST', body: { fields } })
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
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl">
          <Dialog.Title className="text-base font-semibold">New profile</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-neutral-600">
            It starts in setup at 0/10. The rest is filled in on its setup boxes.
          </Dialog.Description>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <Label.Root htmlFor="new-profile-name" className="text-sm font-medium">
                Name
              </Label.Root>
              <input id="new-profile-name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} className={`${input} mt-1.5`} />
            </div>
            <div>
              <Label.Root htmlFor="new-profile-email" className="text-sm font-medium">
                Email <span className="font-normal text-neutral-500">(optional)</span>
              </Label.Root>
              <input
                id="new-profile-email"
                type="email"
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`${input} mt-1.5`}
              />
            </div>
            <div>
              <Label.Root htmlFor="new-profile-id" className="text-sm font-medium">
                Facebook profile ID <span className="font-normal text-neutral-500">(optional)</span>
              </Label.Root>
              <input
                id="new-profile-id"
                inputMode="numeric"
                value={facebookId}
                onChange={(e) => setFacebookId(e.target.value)}
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
                {busy ? 'Creating…' : 'Create profile'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
