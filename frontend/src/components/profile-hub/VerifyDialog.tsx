import { Check } from 'lucide-react'
import { Checkbox, Dialog } from 'radix-ui'
import { useState } from 'react'
import { useAuth } from '../../auth'
import { api, ApiError, type ApiRecord } from '../../lib/api'
import { checkbox } from '../DataTable'
import { button } from '../ui'
import { FINAL_VERIFICATION, localDate } from './sop'

interface Props {
  profile: { id: string; name: string }
  onClose: () => void
  // the record as stored once it is marked complete
  onCompleted: (record: ApiRecord) => void
}

// The last check before a profile goes live: every line has to be confirmed
export function VerifyDialog({ profile, onClose, onCompleted }: Props) {
  const { expire } = useAuth()
  const [ticked, setTicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  function toggle(index: number, on: boolean) {
    const next = new Set(ticked)
    if (on) next.add(index)
    else next.delete(index)
    setTicked(next)
  }

  async function complete() {
    setBusy(true)
    setError(undefined)
    try {
      onCompleted(
        await api<ApiRecord>(`/data/profiles/${profile.id}`, {
          method: 'PATCH',
          body: { fields: { 'Setup Complete': true, 'Setup Completed On': localDate() } },
        }),
      )
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) expire()
      else setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
          <Dialog.Title className="text-base font-semibold">Final verification</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-neutral-600">
            Confirm each point for {profile.name}. Marking setup complete makes the profile live.
          </Dialog.Description>

          <ul className="mt-5 space-y-3">
            {FINAL_VERIFICATION.map((item, index) => (
              <li key={item}>
                <label className="flex items-start gap-3 text-sm">
                  <Checkbox.Root checked={ticked.has(index)} onCheckedChange={(on) => toggle(index, on === true)} className={`${checkbox} mt-0.5 shrink-0`}>
                    <Checkbox.Indicator>
                      <Check className="size-3" strokeWidth={3} />
                    </Checkbox.Indicator>
                  </Checkbox.Root>
                  {item}
                </label>
              </li>
            ))}
          </ul>

          {error && (
            <p role="alert" className="mt-4 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="mt-6 flex items-center justify-end gap-2">
            <span className="mr-auto text-xs text-neutral-500 tabular-nums">
              {ticked.size} of {FINAL_VERIFICATION.length} confirmed
            </span>
            <Dialog.Close type="button" className={button.secondary}>
              Cancel
            </Dialog.Close>
            <button type="button" disabled={busy || ticked.size < FINAL_VERIFICATION.length} onClick={complete} className={button.primary}>
              {busy ? 'Saving…' : 'Mark setup complete'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
