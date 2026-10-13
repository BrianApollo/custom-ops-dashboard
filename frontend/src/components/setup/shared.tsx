import { AlertDialog, Label } from 'radix-ui'
import { useState, type ReactNode } from 'react'
import { button } from '../ui'

// Written out rather than built on button.primary, whose blue would compete with the red
const danger =
  'inline-flex items-center justify-center gap-1.5 rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500'

// What a read-only field looks like: still selectable text, visibly not editable
export const readOnlyInput = 'read-only:bg-neutral-50 read-only:text-neutral-700 read-only:focus:border-neutral-300 read-only:focus:ring-0'

interface SectionProps {
  title: string
  hint?: string
  // buttons on the right of the heading
  action?: ReactNode
  children: ReactNode
}

export function Section({ title, hint, action, children }: SectionProps) {
  return (
    <section className="rounded-lg border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 px-5 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="px-5 py-5">{children}</div>
    </section>
  )
}

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <Label.Root htmlFor={id} className="text-sm font-medium">
        {label}
      </Label.Root>
      {children}
      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  )
}

interface ConfirmProps {
  title: string
  description: ReactNode
  confirmLabel?: string
  // the dialog stays open while this runs, and shows the error if it fails
  onConfirm: () => Promise<void>
  onClose: () => void
}

export function ConfirmDelete({ title, description, confirmLabel = 'Delete', onConfirm, onClose }: ConfirmProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function confirm() {
    setBusy(true)
    setError(undefined)
    try {
      await onConfirm()
      onClose()
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
          <AlertDialog.Description className="mt-1 text-sm text-neutral-600">{description}</AlertDialog.Description>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel disabled={busy} className={button.secondary}>
              Cancel
            </AlertDialog.Cancel>
            {/* a plain button, so the dialog does not close before the request has answered */}
            <button onClick={confirm} disabled={busy} className={danger}>
              {busy ? 'Deleting…' : confirmLabel}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
