import { Check, CircleAlert } from 'lucide-react'
import { Checkbox } from 'radix-ui'
import { useState, type ReactNode } from 'react'
import { useAuth } from '../../auth'
import { api, ApiError, type ApiRecord, type Attachment } from '../../lib/api'
import { checkbox } from '../DataTable'
import { button, input, Tip } from '../ui'
import { SecretField, TextField } from './fields'
import { Screenshots } from './Screenshots'
import { ORIGINAL_KEYS, originalValue, parseOriginal, parseSupplierLine, receivedComplete, STAGES, type FieldSpec, type Stage } from './sop'

// Unsaved edits of one profile, by field name. A key is present only while its
// value differs from what is stored, so "has unsaved edits" is "has keys".
// Fields shown in two boxes (the email, the 2FA secret) share one entry.
export type Draft = Record<string, string | boolean>

// the delivered values live inside one JSON field; each gets its own draft key
const ORIGINAL = 'original:'
const DONE_FIELDS = new Set(STAGES.map((stage) => stage.doneField))

// delivered value -> the live field it seeds
const SEEDS: Record<string, string> = {
  password: 'Profile FB Password',
  twoFaKey: 'Profile 2FA',
  email: 'Profile Email',
  emailPassword: 'Profile Email Password',
  recoveryEmail: 'Profile Security Email',
}

interface Editor {
  value: (key: string) => string | boolean
  dirty: (key: string) => boolean
  set: (entries: Record<string, string | boolean>) => void
  discard: (keys: string[]) => void
  save: (keys: string[]) => Promise<void>
}

interface BoxProps {
  number: number
  title: string
  timing?: string
  summary: string
  // every draft key this box owns
  keys: string[]
  // the stage's Done checkbox; box 1 has none
  doneField?: string
  // stored as complete
  complete: boolean
  editor: Editor
  steps?: string[]
  children?: ReactNode
}

// One setup box with its own Save. Saving sends only this box's edits and
// leaves every other box's unsaved edits as they are.
function Box({ number, title, timing, summary, keys, doneField, complete, editor, steps, children }: BoxProps) {
  const { expire } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [justSaved, setJustSaved] = useState(false)
  const unsaved = keys.some(editor.dirty)

  async function save() {
    setBusy(true)
    setError(undefined)
    try {
      await editor.save(keys)
      setJustSaved(true)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) expire()
      else setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const edge = unsaved ? 'border-l-amber-500' : complete ? 'border-l-emerald-600' : 'border-l-neutral-300'
  return (
    <section aria-labelledby={`box-${number}`} className={`rounded-lg border border-l-4 border-neutral-200 bg-white ${edge}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4">
        <div className="min-w-0">
          <h2 id={`box-${number}`} className="text-base font-semibold">
            <span className="mr-2 text-neutral-400 tabular-nums">{number}</span>
            {title}
            {timing && <span className="ml-2 text-xs font-normal text-neutral-500">{timing}</span>}
          </h2>
          <p className="mt-0.5 text-sm text-neutral-600">{summary}</p>
        </div>
        <div className="flex items-center gap-4">
          <span
            role="status"
            className={`inline-flex items-center gap-1 text-xs font-medium ${unsaved ? 'text-amber-700' : justSaved ? 'text-emerald-700' : 'text-neutral-500'}`}
          >
            {unsaved ? <CircleAlert className="size-3.5" /> : <Check className="size-3.5" />}
            {unsaved ? 'Unsaved changes' : justSaved ? 'Saved just now' : 'Saved'}
          </span>
          {doneField ? (
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox.Root
                checked={editor.value(doneField) === true}
                onCheckedChange={(checked) => editor.set({ [doneField]: checked === true })}
                className={checkbox}
              >
                <Checkbox.Indicator>
                  <Check className="size-3" strokeWidth={3} />
                </Checkbox.Indicator>
              </Checkbox.Root>
              Done
            </label>
          ) : (
            <span className={`text-sm font-medium ${complete ? 'text-emerald-700' : 'text-neutral-500'}`}>{complete ? 'Complete' : 'Incomplete'}</span>
          )}
        </div>
      </div>

      <div className="space-y-4 px-5 py-4">
        {children}
        {steps && (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium text-blue-700 hover:text-blue-800">How do I?</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-neutral-700">
              {steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </details>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-5 py-3">
        {error && (
          <p role="alert" className="mr-auto text-sm text-red-700">
            Not saved: {error}
          </p>
        )}
        <button
          type="button"
          disabled={!unsaved || busy}
          onClick={() => {
            editor.discard(keys)
            setError(undefined)
          }}
          className={button.secondary}
        >
          Discard
        </button>
        <button type="button" disabled={!unsaved || busy} onClick={save} className={button.primary}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </section>
  )
}

const grid = 'grid gap-4 sm:grid-cols-2'

// Whether a credential has been rotated away from what the supplier delivered.
// Compares stored values only and never shows either of them.
function Rotation({ live, delivered }: { live: string; delivered: string }) {
  if (!delivered) return <p className="mt-1 text-xs text-neutral-500">No delivered value to compare with.</p>
  const [tone, label] = !live
    ? ['text-amber-700', 'Live value is empty']
    : live === delivered
      ? ['text-amber-700', 'Still the delivered value']
      : ['text-emerald-700', 'Changed from the delivered value']
  return <p className={`mt-1 text-xs font-medium ${tone}`}>{label}</p>
}

interface Props {
  // the profile as stored
  record: ApiRecord
  draft: Draft
  onDraft: (update: (draft: Draft) => Draft) => void
  // the record as stored after a write
  onSaved: (record: ApiRecord) => void
  // record id -> name, for the read-only link lists
  linkNames: Record<'Linked BM' | 'Linked Pages', Map<string, string>>
}

export function SetupBoxes({ record, draft, onDraft, onSaved, linkNames }: Props) {
  const rawOriginal = record.fields['Original Data']
  const original = parseOriginal(rawOriginal)
  // text is there but cannot be read as the delivered values
  const unreadable = typeof rawOriginal === 'string' && rawOriginal.trim() !== '' && Object.keys(original).length === 0
  const [line, setLine] = useState('')
  const [lineResult, setLineResult] = useState<{ ok: boolean; notes: string[] }>()

  function stored(key: string): string | boolean {
    if (key.startsWith(ORIGINAL)) return originalValue(original, key.slice(ORIGINAL.length))
    const value = record.fields[key]
    if (DONE_FIELDS.has(key)) return value === true
    return value === undefined || value === null ? '' : String(value)
  }

  const editor: Editor = {
    value: (key) => (key in draft ? draft[key] : stored(key)),
    dirty: (key) => key in draft,
    set(entries) {
      onDraft((current) => {
        const next = { ...current }
        for (const [key, value] of Object.entries(entries)) {
          if (value === stored(key)) delete next[key]
          else next[key] = value
        }
        return next
      })
    },
    discard(keys) {
      onDraft((current) => Object.fromEntries(Object.entries(current).filter(([key]) => !keys.includes(key))))
    },
    async save(keys) {
      const sent = Object.fromEntries(Object.entries(draft).filter(([key]) => keys.includes(key)))
      const fields: Record<string, unknown> = {}
      const delivered: Record<string, unknown> = { ...original }
      let deliveredChanged = false
      for (const [key, value] of Object.entries(sent)) {
        if (!key.startsWith(ORIGINAL)) {
          fields[key] = value
          continue
        }
        deliveredChanged = true
        if (value === '') delete delivered[key.slice(ORIGINAL.length)]
        else delivered[key.slice(ORIGINAL.length)] = value
      }
      if (deliveredChanged) fields['Original Data'] = Object.keys(delivered).length ? JSON.stringify(delivered, null, 2) : ''

      onSaved(await api<ApiRecord>(`/data/profiles/${record.id}`, { method: 'PATCH', body: { fields } }))
      // what was typed while the request was out stays unsaved
      onDraft((current) => Object.fromEntries(Object.entries(current).filter(([key, value]) => !(key in sent && sent[key] === value))))
    },
  }

  const text = (key: string) => String(editor.value(key))

  function field(prefix: string, spec: FieldSpec, key = spec.field) {
    const Field = spec.kind ? SecretField : TextField
    return (
      <Field
        key={key}
        id={`${prefix}-${key.replace(/[^a-z0-9]+/gi, '-')}`}
        label={spec.label}
        hint={spec.hint}
        multiline={spec.kind === 'secret-multiline'}
        value={text(key)}
        dirty={editor.dirty(key)}
        onChange={(value) => editor.set({ [key]: value })}
        note={spec.replaces ? <Rotation live={String(stored(spec.field))} delivered={originalValue(original, spec.replaces)} /> : undefined}
      />
    )
  }

  function fillFromLine() {
    const parsed = parseSupplierLine(line)
    // the pasted line holds passwords, so it is not kept on screen either way
    setLine('')
    if (!parsed) {
      setLineResult({ ok: false, notes: ['That is not a supplier line: it needs at least seven values separated by |.'] })
      return
    }
    const entries: Record<string, string> = Object.fromEntries(Object.entries(parsed.values).map(([key, value]) => [ORIGINAL + key, value]))
    if (parsed.extras.length) {
      const extra = `Extra from supplier line: ${parsed.extras.join(' | ')}`
      entries['Extra Notes'] = [text('Extra Notes'), extra].filter(Boolean).join('\n')
    }
    editor.set(entries)
    setLineResult({ ok: true, notes: parsed.warnings })
  }

  function seedLiveFields() {
    const entries: Record<string, string> = {}
    for (const [key, target] of Object.entries(SEEDS)) {
      const value = text(ORIGINAL + key)
      if (value) entries[target] = value
    }
    editor.set(entries)
  }

  const receivedKeys = [...ORIGINAL_KEYS.map(({ key }) => ORIGINAL + key), 'Extra Notes']

  function stageBox(stage: Stage) {
    const linked = stage.links ? ((record.fields[stage.links] as string[] | undefined) ?? []) : []
    return (
      <Box
        key={stage.number}
        number={stage.number + 1}
        title={stage.title}
        timing={stage.timing}
        summary={stage.summary}
        keys={[stage.doneField, ...stage.fields.map((spec) => spec.field)]}
        doneField={stage.doneField}
        complete={record.fields[stage.doneField] === true}
        editor={editor}
        steps={stage.steps}
      >
        {stage.fields.length > 0 && <div className={grid}>{stage.fields.map((spec) => field(`stage-${stage.number}`, spec))}</div>}

        {stage.number === 1 && (
          // AdsPower runs on a staff PC and has no route in our API
          <Tip label="Picking from AdsPower and comparing with it is not available yet. Type the AdsPower user ID instead.">
            <button type="button" aria-disabled className={`${button.secondary} cursor-not-allowed opacity-60`}>
              Pick from AdsPower
            </button>
          </Tip>
        )}

        {stage.links && (
          <div>
            <span className="text-sm font-medium">{stage.links === 'Linked BM' ? 'Business Managers' : 'Pages'}</span>
            {linked.length === 0 ? (
              <p className="mt-1 text-sm text-neutral-500">None linked yet. Links are added by the Facebook sync.</p>
            ) : (
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {linked.map((id) => (
                  <li key={id} className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700 ring-1 ring-neutral-500/20 ring-inset">
                    {linkNames[stage.links!].get(id) || id}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {stage.screenshot && (
          <Screenshots
            profileId={record.id}
            field={stage.screenshot.field}
            hint={stage.screenshot.hint}
            files={(record.fields[stage.screenshot.field] as Attachment[] | undefined) ?? []}
            onSaved={onSaved}
          />
        )}
      </Box>
    )
  }

  return (
    <div className="space-y-4">
      <Box
        number={1}
        title="What we received"
        summary="The credentials the profile arrived with, kept as delivered while the live ones are rotated."
        keys={receivedKeys}
        complete={receivedComplete(record)}
        editor={editor}
      >
        {unreadable && (
          <p role="alert" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
            The stored delivered data is not in the expected format. Saving this box replaces it.
          </p>
        )}

        <div>
          <label htmlFor="supplier-line" className="text-sm font-medium">
            Quick add from a supplier line
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="supplier-line"
              // masked: the line is seven credentials in a row
              type="password"
              autoComplete="new-password"
              data-1p-ignore
              data-lpignore="true"
              placeholder="uid | password | 2FA key | email | email password | recovery email | cookies"
              value={line}
              onChange={(e) => setLine(e.target.value)}
              className={input}
            />
            <button type="button" disabled={!line.trim()} onClick={fillFromLine} className={`${button.secondary} shrink-0`}>
              Fill
            </button>
          </div>
          {lineResult && (
            <ul role="status" className={`mt-1.5 space-y-0.5 text-xs ${lineResult.ok ? 'text-amber-700' : 'text-red-700'}`}>
              {lineResult.ok && <li className="text-neutral-600">Filled the fields below. Check them, then save this box.</li>}
              {lineResult.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </div>

        <div className={grid}>
          {ORIGINAL_KEYS.map((spec) =>
            field('received', { field: spec.key, label: spec.label, hint: spec.hint, kind: spec.secret ? (spec.multiline ? 'secret-multiline' : 'secret') : undefined }, ORIGINAL + spec.key),
          )}
        </div>
        <TextField
          id="received-extra-notes"
          label="Extra notes"
          multiline
          value={text('Extra Notes')}
          dirty={editor.dirty('Extra Notes')}
          onChange={(value) => editor.set({ 'Extra Notes': value })}
        />

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={seedLiveFields} className={button.secondary}>
            Copy into the live fields
          </button>
          <p className="text-xs text-neutral-500">
            Fills the password, 2FA, email and backup email fields in the boxes below. Nothing is stored until those boxes are saved.
          </p>
        </div>
      </Box>

      {STAGES.map(stageBox)}
    </div>
  )
}
