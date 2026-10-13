import { Check } from 'lucide-react'
import { Checkbox, Dialog, RadioGroup } from 'radix-ui'
import { useState, type FormEvent } from 'react'
import { api } from '../../lib/api'
import { checkbox } from '../DataTable'
import { button } from '../ui'
import type { Editor } from '../videos/ServerTable'

interface Props {
  scriptIds: string[]
  // what is being assigned, e.g. the script's name or `12 scripts`
  label: string
  // the editors who can be given work
  editors: Editor[]
  onClose: () => void
  // videos were created, so the list should load again
  onAssigned: () => void
}

const FORMATS = ['Vertical', 'Square', 'YouTube']
const TEXT_VERSIONS = ['Text', 'No Text']
// the most the server takes in one request
const MAX_SCRIPTS = 1000

function toggled(set: Set<string>, value: string, on: boolean) {
  const next = new Set(set)
  if (on) next.add(value)
  else next.delete(value)
  return next
}

interface ChoicesProps {
  legend: string
  options: { value: string; label: string }[]
  value: Set<string>
  onChange: (value: Set<string>) => void
}

function Choices({ legend, options, value, onChange }: ChoicesProps) {
  return (
    <fieldset>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
        {options.map((option) => (
          <label key={option.value} className="flex items-center gap-2 text-sm text-neutral-800">
            <Checkbox.Root checked={value.has(option.value)} onCheckedChange={(on) => onChange(toggled(value, option.value, on === true))} className={checkbox}>
              <Checkbox.Indicator>
                <Check className="size-3" />
              </Checkbox.Indicator>
            </Checkbox.Root>
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

const named = (values: string[]) => values.map((value) => ({ value, label: value }))

// Gives scripts to editors: one To Do video per script, editor, format and text version.
// A combination that already has a video is left alone, so assigning twice does no harm.
export function AssignDialog({ scriptIds, label, editors, onClose, onAssigned }: Props) {
  const [who, setWho] = useState<'all' | 'chosen'>('all')
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [formats, setFormats] = useState(new Set(FORMATS))
  const [textVersions, setTextVersions] = useState(new Set(TEXT_VERSIONS))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [result, setResult] = useState<{ created: number; skipped: number }>()

  const editorCount = who === 'all' ? editors.length : chosen.size
  const wanted = scriptIds.length * editorCount * formats.size * textVersions.size
  const tooMany = scriptIds.length > MAX_SCRIPTS

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const answer = await api<{ created: number; skipped: number }>('/videos/bulk-assign', {
        method: 'POST',
        body: {
          scriptIds,
          // an empty list means every active video editor
          editorIds: who === 'all' ? [] : [...chosen],
          // sent in the fixed order, so the videos are created in the order the lists show them
          formats: FORMATS.filter((format) => formats.has(format)),
          textVersions: TEXT_VERSIONS.filter((version) => textVersions.has(version)),
        },
      })
      setResult(answer)
      onAssigned()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const videos = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'video' : 'videos'}`

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
          <Dialog.Title className="text-base font-semibold">Assign to editors</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm break-words text-neutral-600">{label}</Dialog.Description>

          {result ? (
            <>
              <p role="status" className="mt-5 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                Created {videos(result.created)}.
                {result.skipped > 0 && ` Skipped ${result.skipped.toLocaleString()} that already existed.`}
              </p>
              <div className="mt-5 flex justify-end">
                <Dialog.Close className={button.primary}>Done</Dialog.Close>
              </div>
            </>
          ) : (
            <form onSubmit={submit} className="mt-5 space-y-5">
              <fieldset>
                <legend className="text-sm font-medium">Editors</legend>
                <RadioGroup.Root
                  value={who}
                  onValueChange={(value) => setWho(value as 'all' | 'chosen')}
                  aria-label="Editors"
                  className="mt-2 space-y-2"
                >
                  {[
                    { value: 'all', label: `All active editors (${editors.length})` },
                    { value: 'chosen', label: 'Only the ones I choose' },
                  ].map((option) => (
                    <label key={option.value} className="flex items-center gap-2 text-sm text-neutral-800">
                      <RadioGroup.Item
                        value={option.value}
                        className="flex size-4 items-center justify-center rounded-full border border-neutral-400 bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 data-[state=checked]:border-blue-700"
                      >
                        <RadioGroup.Indicator className="size-2 rounded-full bg-blue-700" />
                      </RadioGroup.Item>
                      {option.label}
                    </label>
                  ))}
                </RadioGroup.Root>
                {who === 'chosen' && (
                  <div className="mt-3 max-h-40 space-y-2 overflow-y-auto rounded-md border border-neutral-200 p-3">
                    {editors.map((editor) => (
                      <label key={editor.id} className="flex items-center gap-2 text-sm text-neutral-800">
                        <Checkbox.Root
                          checked={chosen.has(editor.id)}
                          onCheckedChange={(on) => setChosen(toggled(chosen, editor.id, on === true))}
                          className={checkbox}
                        >
                          <Checkbox.Indicator>
                            <Check className="size-3" />
                          </Checkbox.Indicator>
                        </Checkbox.Root>
                        {editor.name}
                      </label>
                    ))}
                    {editors.length === 0 && <p className="text-sm text-neutral-500">There are no active video editors.</p>}
                  </div>
                )}
              </fieldset>

              <Choices legend="Formats" options={named(FORMATS)} value={formats} onChange={setFormats} />
              <Choices
                legend="Text versions"
                options={[
                  { value: 'Text', label: 'With text' },
                  { value: 'No Text', label: 'No text' },
                ]}
                value={textVersions}
                onChange={setTextVersions}
              />

              <p className="text-sm text-neutral-600" aria-live="polite">
                {tooMany
                  ? `At most ${MAX_SCRIPTS.toLocaleString()} scripts can be assigned at once. Select fewer.`
                  : wanted
                    ? `Up to ${videos(wanted)} will be created. Ones that already exist are skipped.`
                    : 'Choose at least one editor, format and text version.'}
              </p>
              {error && (
                <p role="alert" className="text-sm text-red-700">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Dialog.Close type="button" className={button.secondary}>
                  Cancel
                </Dialog.Close>
                <button type="submit" disabled={busy || !wanted || tooMany} className={button.primary}>
                  {busy ? 'Assigning…' : 'Assign'}
                </button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
