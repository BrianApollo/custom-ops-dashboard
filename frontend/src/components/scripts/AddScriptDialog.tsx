import { Check, Plus, Trash2, X } from 'lucide-react'
import { Checkbox, Dialog, Label } from 'radix-ui'
import { useState, type FormEvent } from 'react'
import { useRecords, useWorkspace, type Product } from '../../data'
import { api, type ApiRecord } from '../../lib/api'
import { checkbox } from '../DataTable'
import { button, input, Select } from '../ui'
import { nextScriptNumber, scriptName } from './naming'

interface Props {
  product: Product
  onClose: () => void
  // called with the names of the scripts that were created
  onCreated: (names: string[]) => void
}

const MIN_HOOKS = 2

// A new script for a product. Its name is made from the product, the product's next script
// number and the author. With hooks, each hook becomes its own script sharing one body.
export function AddScriptDialog({ product, onClose, onCreated }: Props) {
  const { userNames } = useWorkspace()
  const numbering = { fields: 'Name,Base Script Number', 'where[Product]': product.id }
  const existing = useRecords('video_scripts', numbering)

  const [authorId, setAuthorId] = useState('')
  const [withHooks, setWithHooks] = useState(false)
  const [content, setContent] = useState('')
  const [hooks, setHooks] = useState<string[]>(Array(MIN_HOOKS).fill(''))
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const authors = [...userNames].map(([value, label]) => ({ value, label: label || 'Unnamed' })).sort((a, b) => a.label.localeCompare(b.label))
  const authorName = userNames.get(authorId) ?? ''
  const written = hooks.map((hook) => hook.trim()).filter(Boolean)
  const ready = Boolean(authorId) && (!withHooks || (written.length > 0 && Boolean(body.trim())))
  const preview = existing.records ? scriptName(product.name, nextScriptNumber(existing.records), authorName || '?') : ''

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      // the number is worked out from the scripts as they are now, not as they were when the dialog opened
      const fresh = await api<{ records: ApiRecord[] }>(`/data/video_scripts?${new URLSearchParams(numbering)}`)
      const number = nextScriptNumber(fresh.records)
      const shared = { Product: [product.id], Author: [authorId], 'Base Script Number': number }
      const records = withHooks
        ? written.map((hook, i) => ({
            fields: {
              ...shared,
              Name: scriptName(product.name, number, authorName, i + 1),
              'Script Content': `${hook}\n\n${body.trim()}`,
              Hook: hook,
              Body: body.trim(),
              'Hook Number': i + 1,
            },
          }))
        : [{ fields: { ...shared, Name: scriptName(product.name, number, authorName), 'Script Content': content.trim() } }]
      // one request, so a script's hooks are all created or none are
      await api('/data/video_scripts', { method: 'POST', body: { records } })
      onCreated(records.map((record) => record.fields.Name))
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-white shadow-xl"
        >
          <div className="flex items-center gap-3 border-b border-neutral-200 px-6 py-4">
            <Dialog.Title className="min-w-0 flex-1 truncate text-base font-semibold">Add script for {product.name}</Dialog.Title>
            <Dialog.Close aria-label="Close" className={button.icon}>
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
              <div>
                <p className="text-sm font-medium">Name</p>
                <p className="mt-1.5 rounded-md bg-neutral-50 px-3 py-2 text-sm text-neutral-800" aria-live="polite">
                  {existing.error ? <span className="text-red-700">Could not work out the next script number: {existing.error}</span> : preview || 'Loading…'}
                </p>
                <p className="mt-1 text-xs text-neutral-500">Made from the product, its next script number and the author.</p>
              </div>

              <div>
                <Label.Root htmlFor="script-author" className="text-sm font-medium">
                  Author
                </Label.Root>
                <Select
                  id="script-author"
                  value={authorId}
                  options={authors}
                  placeholder={authors.length ? 'Choose an author' : 'No authors available'}
                  disabled={authors.length === 0}
                  onValueChange={setAuthorId}
                  className="mt-1.5 w-full"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-neutral-800">
                <Checkbox.Root checked={withHooks} onCheckedChange={(on) => setWithHooks(on === true)} className={checkbox}>
                  <Checkbox.Indicator>
                    <Check className="size-3" />
                  </Checkbox.Indicator>
                </Checkbox.Root>
                Add hooks: several openings for one body, each saved as its own script
              </label>

              {withHooks ? (
                <>
                  {hooks.map((hook, i) => (
                    <div key={i}>
                      <div className="flex items-center justify-between">
                        <Label.Root htmlFor={`script-hook-${i}`} className="text-sm font-medium">
                          Hook {i + 1}
                        </Label.Root>
                        {hooks.length > MIN_HOOKS && (
                          <button
                            type="button"
                            aria-label={`Remove hook ${i + 1}`}
                            onClick={() => setHooks(hooks.filter((_, at) => at !== i))}
                            className={`${button.icon} -my-1.5`}
                          >
                            <Trash2 className="size-4" />
                          </button>
                        )}
                      </div>
                      <textarea
                        id={`script-hook-${i}`}
                        rows={3}
                        value={hook}
                        onChange={(e) => setHooks(hooks.map((old, at) => (at === i ? e.target.value : old)))}
                        className={`${input} mt-1.5 resize-y leading-relaxed`}
                      />
                    </div>
                  ))}
                  <button type="button" onClick={() => setHooks([...hooks, ''])} className={button.secondary}>
                    <Plus className="size-4" />
                    Add another hook
                  </button>
                  <div>
                    <Label.Root htmlFor="script-body" className="text-sm font-medium">
                      Body
                    </Label.Root>
                    <textarea
                      id="script-body"
                      rows={6}
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      aria-describedby="script-body-hint"
                      className={`${input} mt-1.5 resize-y leading-relaxed`}
                    />
                    <p id="script-body-hint" className="mt-1 text-xs text-neutral-500">
                      Shared by every hook. Empty hooks are left out.
                    </p>
                  </div>
                </>
              ) : (
                <div>
                  <Label.Root htmlFor="script-content" className="text-sm font-medium">
                    Script
                  </Label.Root>
                  <textarea
                    id="script-content"
                    rows={8}
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    className={`${input} mt-1.5 resize-y leading-relaxed`}
                  />
                </div>
              )}

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
                {busy ? 'Creating…' : withHooks && written.length > 1 ? `Create ${written.length} scripts` : 'Create script'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
