import { AlertDialog } from 'radix-ui'
import { useState, type ReactNode } from 'react'
import { button } from '../ui'

interface Props {
  title: string
  // what will happen, in a sentence
  children: ReactNode
  confirmLabel: string
  // label of the button that backs out; 'Cancel' reads wrongly when the action itself is a cancellation
  cancelLabel?: string
  // the dialog stays open while this runs and shows the message if it fails
  onConfirm: () => Promise<void>
  onClose: () => void
}

// Asks before something that cannot be undone
export function ConfirmDialog({ title, children, confirmLabel, cancelLabel = 'Cancel', onConfirm, onClose }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function confirm() {
    setBusy(true)
    setError(undefined)
    try {
      await onConfirm()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl">
          <AlertDialog.Title className="text-base font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-1 text-sm text-neutral-600">{children}</AlertDialog.Description>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel disabled={busy} className={button.secondary}>
              {cancelLabel}
            </AlertDialog.Cancel>
            {/* a plain button: AlertDialog.Action would close the dialog before the request finishes */}
            <button onClick={confirm} disabled={busy} className={`${button.primary} bg-red-700 hover:bg-red-800`}>
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
