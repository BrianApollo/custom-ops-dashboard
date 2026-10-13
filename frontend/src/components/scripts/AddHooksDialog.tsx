import { Plus, Trash2, X } from 'lucide-react'
import { Dialog, Label } from 'radix-ui'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useFetch } from '../../data'
import { api, text, type ApiRecord } from '../../lib/api'
import { button, input } from '../ui'
import { baseNumber, hookName, hookNumber, NUMBERING_FIELDS } from './naming'

interface Props {
  script: { id: string; name: string; productId: string | null }
  onClose: () => void
  // called with how many scripts were created
  onAdded: (created: number) => void
}

const first = (record: ApiRecord, field: string) => (record.fields[field] as string[] | undefined)?.[0]

// Adds hooks to an existing script. The first time, the script is split into its hook and
// body and becomes hook 1; every further hook is a new script sharing that body.
export function AddHooksDialog({ script, onClose, onAdded }: Props) {
  const record = useFetch<ApiRecord>(`/data/video_scripts/${script.id}`)
  // the other hooks of this script are found among the product's scripts
  const siblings = useFetch<{ records: ApiRecord[] }>(
    script.productId ? `/data/video_scripts?${new URLSearchParams({ fields: NUMBERING_FIELDS, 'where[Product]': script.productId })}` : null,
  )
  const error = record.error ?? siblings.error
  const loaded = record.data && (siblings.data || !script.productId)

  let content: ReactNode
  if (error) content = <p className="px-6 py-10 text-center text-sm text-red-700">Could not load the script: {error.message}</p>
  else if (!loaded) content = <p className="px-6 py-10 text-center text-sm text-neutral-500">Loading…</p>
  else if (baseNumber(record.data!) === null) {
    content = (
      <p className="px-6 py-10 text-center text-sm text-neutral-600">
        This script has no script number in its name (“Script 1001”), so hooks cannot be numbered for it.
      </p>
    )
  } else content = <HooksForm record={record.data!} scripts={siblings.data?.records ?? []} onAdded={onAdded} />

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-white shadow-xl"
        >
          <div className="flex items-center gap-3 border-b border-neutral-200 px-6 py-4">
            <Dialog.Title className="min-w-0 flex-1 truncate text-base font-semibold">Add hooks to {script.name}</Dialog.Title>
            <Dialog.Close aria-label="Close" className={button.icon}>
              <X className="size-4" />
            </Dialog.Close>
          </div>
          {content}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// the text up to the first blank line is the likeliest hook; the author corrects it if not
function split(content: string) {
  const [hook, ...rest] = content.trim().split(/\n\s*\n/)
  return { hook: hook.trim(), body: rest.join('\n\n').trim() }
}

function HooksForm({ record, scripts, onAdded }: { record: ApiRecord; scripts: ApiRecord[]; onAdded: (created: number) => void }) {
  const number = baseNumber(record)!
  // every script with this script's number, itself included, that is already a hook
  const family = [record, ...scripts.filter((other) => other.id !== record.id && baseNumber(other) === number)]
  const existing = family
    .filter((member) => hookNumber(member) !== null)
    .sort((a, b) => hookNumber(a)! - hookNumber(b)!)
  const firstTime = existing.length === 0
  // new hooks continue after the highest one in use, so no two hooks share a number or a name
  const next = firstTime ? 2 : Math.max(...existing.map((member) => hookNumber(member)!)) + 1
  const sharedBody = existing.map((member) => text(member, 'Body')).find(Boolean)
  const original = split(text(record, 'Script Content'))

  const [hookOne, setHookOne] = useState(original.hook)
  const [body, setBody] = useState(sharedBody ?? (firstTime ? original.body : ''))
  const [hooks, setHooks] = useState<string[]>([''])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const written = hooks.map((hook) => hook.trim()).filter(Boolean)
  // the first time, splitting the script is worth saving on its own
  const ready = Boolean(body.trim()) && (firstTime ? Boolean(hookOne.trim()) : written.length > 0)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    const shared = { Body: body.trim(), 'Base Script Number': number }
    try {
      if (firstTime) {
        // the script keeps its name and becomes hook 1
        await api(`/data/video_scripts/${record.id}`, {
          method: 'PATCH',
          body: { fields: { ...shared, 'Script Content': `${hookOne.trim()}\n\n${body.trim()}`, Hook: hookOne.trim(), 'Hook Number': 1 } },
        })
      }
      if (written.length) {
        const records = written.map((hook, i) => ({
          fields: {
            ...shared,
            Name: hookName(text(record, 'Name'), next + i),
            Product: record.fields.Product ?? [],
            Author: record.fields.Author ?? [],
            'Script Content': `${hook}\n\n${body.trim()}`,
            Hook: hook,
            'Hook Number': next + i,
          },
        }))
        await api('/data/video_scripts', { method: 'POST', body: { records } })
      }
      onAdded(written.length)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const area = `${input} mt-1.5 resize-y leading-relaxed`

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {firstTime ? (
          <>
            <p className="text-sm text-neutral-600">
              This script has no hooks yet. Split it into its opening hook and the body the other hooks will share. It keeps its name and
              becomes hook 1.
            </p>
            <div>
              <Label.Root htmlFor="hook-1" className="text-sm font-medium">
                Hook 1
              </Label.Root>
              <textarea id="hook-1" rows={3} value={hookOne} onChange={(e) => setHookOne(e.target.value)} className={area} />
            </div>
          </>
        ) : (
          <div>
            <h3 className="text-sm font-medium">Existing hooks</h3>
            <ul className="mt-1.5 space-y-1.5 text-sm text-neutral-700">
              {existing.map((member) => (
                <li key={member.id} className="flex gap-2">
                  <span className="shrink-0 font-medium text-neutral-900">Hook {hookNumber(member)}</span>
                  <span className="min-w-0 truncate">{text(member, 'Hook') || text(member, 'Name')}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <Label.Root htmlFor="hooks-body" className="text-sm font-medium">
            Body
          </Label.Root>
          {/* once hooks share a body it is fixed: changing it here would leave the earlier hooks with the old one */}
          <textarea
            id="hooks-body"
            rows={6}
            readOnly={Boolean(sharedBody)}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            aria-describedby="hooks-body-hint"
            className={`${area} ${sharedBody ? 'bg-neutral-50 text-neutral-600' : ''}`}
          />
          <p id="hooks-body-hint" className="mt-1 text-xs text-neutral-500">
            {sharedBody ? 'Shared by every hook of this script.' : 'Every hook is followed by this text.'}
          </p>
        </div>

        {hooks.map((hook, i) => (
          <div key={i}>
            <div className="flex items-center justify-between">
              <Label.Root htmlFor={`new-hook-${i}`} className="text-sm font-medium">
                Hook {next + i}
              </Label.Root>
              {hooks.length > 1 && (
                <button
                  type="button"
                  aria-label={`Remove hook ${next + i}`}
                  onClick={() => setHooks(hooks.filter((_, at) => at !== i))}
                  className={`${button.icon} -my-1.5`}
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
            <textarea
              id={`new-hook-${i}`}
              rows={3}
              value={hook}
              onChange={(e) => setHooks(hooks.map((old, at) => (at === i ? e.target.value : old)))}
              className={area}
            />
          </div>
        ))}
        <button type="button" onClick={() => setHooks([...hooks, ''])} className={button.secondary}>
          <Plus className="size-4" />
          Add another hook
        </button>
        <p className="text-xs text-neutral-500">
          Each new hook is saved as its own script, named like {hookName(text(record, 'Name'), next)}. Empty ones are left out.
        </p>

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
        <button type="submit" disabled={busy || !ready} className={button.primary}>
          {busy ? 'Saving…' : written.length ? `Create ${written.length} ${written.length === 1 ? 'hook' : 'hooks'}` : 'Save the split'}
        </button>
      </div>
    </form>
  )
}
