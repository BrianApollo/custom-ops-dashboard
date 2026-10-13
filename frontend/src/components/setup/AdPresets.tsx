import { Copy, Eye, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useState, type FormEvent } from 'react'
import { useRecords, type Product } from '../../data'
import { api, text, type ApiRecord } from '../../lib/api'
import { CALLS_TO_ACTION } from '../../pages/launcher/draft'
import { DataTable, type Column } from '../DataTable'
import { button, input, Select, Tip } from '../ui'
import { ConfirmDelete, Field, readOnlyInput, Section } from './shared'

const SLOTS = 5
// Radix Select has no empty value, so "no call to action" needs one of its own
const NONE = 'none'

// The three kinds of ad text; each is stored in fields `{field} 1` to `{field} 5`
const KINDS = [
  { field: 'Primary Text', label: 'Primary texts', one: 'Primary text', long: true },
  { field: 'Headline', label: 'Headlines', one: 'Headline', long: false },
  { field: 'Description', label: 'Descriptions', one: 'Description', long: false },
] as const

type Kind = (typeof KINDS)[number]
type Texts = Record<Kind['field'], string[]>

const label = (record: ApiRecord) => text(record, 'Preset Name') || 'Untitled'

// the slots that hold something, in order
const filled = (record: ApiRecord, field: string) =>
  Array.from({ length: SLOTS }, (_, i) => text(record, `${field} ${i + 1}`)).filter((value) => value.trim())

// All of a kind's five fields: the values first, then '' so a removed text is cleared in the record
const slotFields = (field: string, values: string[]) => {
  const kept = values.filter((value) => value.trim())
  return Object.fromEntries(Array.from({ length: SLOTS }, (_, i) => [`${field} ${i + 1}`, kept[i] ?? '']))
}

export function AdPresets({ product, canEdit }: { product: Product; canEdit: boolean }) {
  const { records, error, loading, reload } = useRecords('ad_presets', { 'where[Product]': product.id, sort: '-Preset Name' })
  // the preset in the dialog; no record while creating one
  const [open, setOpen] = useState<{ record?: ApiRecord } | null>(null)
  const [deleting, setDeleting] = useState<ApiRecord | null>(null)
  const [copying, setCopying] = useState<string>()
  const [copyError, setCopyError] = useState<string>()

  async function duplicate(record: ApiRecord) {
    setCopying(record.id)
    setCopyError(undefined)
    const fields = {
      ...Object.fromEntries(KINDS.map((kind) => Object.entries(slotFields(kind.field, filled(record, kind.field)))).flat()),
      'Preset Name': `${label(record)} - copy`,
      'Call to Action': text(record, 'Call to Action'),
      'Beneficiary Name': text(record, 'Beneficiary Name'),
      'Payer Name': text(record, 'Payer Name'),
      Notes: text(record, 'Notes'),
      Product: [product.id],
    }
    try {
      await api('/data/ad_presets', { method: 'POST', body: { fields } })
      reload()
    } catch (err) {
      setCopyError(`Could not duplicate ${label(record)}: ${(err as Error).message}`)
    } finally {
      setCopying(undefined)
    }
  }

  const columns: Column<ApiRecord>[] = [
    { header: 'Preset', cell: label },
    ...KINDS.map((kind) => ({ header: kind.label, align: 'right' as const, cell: (record: ApiRecord) => filled(record, kind.field).length })),
    { header: 'Call to action', cell: (record) => text(record, 'Call to Action') },
    {
      header: 'Actions',
      align: 'right',
      cell: (record) => (
        <span className="inline-flex">
          {canEdit ? (
            <>
              <Tip label="Edit">
                <button aria-label={`Edit ${label(record)}`} onClick={() => setOpen({ record })} className={button.icon}>
                  <Pencil className="size-4" />
                </button>
              </Tip>
              <Tip label="Duplicate">
                <button
                  aria-label={`Duplicate ${label(record)}`}
                  disabled={copying !== undefined}
                  onClick={() => void duplicate(record)}
                  className={button.icon}
                >
                  <Copy className="size-4" />
                </button>
              </Tip>
              <Tip label="Delete">
                <button aria-label={`Delete ${label(record)}`} onClick={() => setDeleting(record)} className={button.icon}>
                  <Trash2 className="size-4" />
                </button>
              </Tip>
            </>
          ) : (
            <Tip label="View">
              <button aria-label={`View ${label(record)}`} onClick={() => setOpen({ record })} className={button.icon}>
                <Eye className="size-4" />
              </button>
            </Tip>
          )}
        </span>
      ),
    },
  ]

  const usedBy = deleting ? ((deleting.fields.Campaigns as string[] | undefined) ?? []).length : 0

  return (
    <Section
      title="Ad presets"
      hint="Sets of ad texts a campaign of this product can be launched with."
      action={
        canEdit && (
          <button onClick={() => setOpen({})} className={button.primary}>
            <Plus className="size-4" />
            Create preset
          </button>
        )
      }
    >
      <DataTable
        columns={columns}
        rows={records ?? []}
        rowKey={(record) => record.id}
        empty={error ? `Could not load the ad presets: ${error}` : loading ? 'Loading…' : 'This product has no ad presets yet.'}
        emptyIsError={Boolean(error)}
      />
      {copyError && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {copyError}
        </p>
      )}

      {open && (
        <PresetDialog
          record={open.record}
          product={product}
          // the name a new preset starts with; it can be changed before anything is saved
          suggestedName={`Preset ${(records?.length ?? 0) + 1}`}
          canEdit={canEdit}
          onClose={() => setOpen(null)}
          onSaved={() => {
            setOpen(null)
            reload()
          }}
        />
      )}

      {deleting && (
        <ConfirmDelete
          title={`Delete ${label(deleting)}?`}
          description={
            usedBy
              ? `${usedBy} ${usedBy === 1 ? 'campaign has' : 'campaigns have'} this preset selected. This cannot be undone.`
              : 'This cannot be undone.'
          }
          onConfirm={async () => {
            await api(`/data/ad_presets/${deleting.id}`, { method: 'DELETE' })
            reload()
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </Section>
  )
}

interface DialogProps {
  // none when creating
  record?: ApiRecord
  product: Product
  suggestedName: string
  canEdit: boolean
  onClose: () => void
  onSaved: () => void
}

// One preset: the form for creating or editing it, and the read-only view for people who cannot edit.
// Nothing is written until Save, so a new preset can be filled in and saved in one go.
function PresetDialog({ record, product, suggestedName, canEdit, onClose, onSaved }: DialogProps) {
  const start = (field: string) => (record ? text(record, field) : '')
  const [name, setName] = useState(record ? text(record, 'Preset Name') : suggestedName)
  const [callToAction, setCallToAction] = useState(start('Call to Action'))
  const [beneficiary, setBeneficiary] = useState(start('Beneficiary Name'))
  const [payer, setPayer] = useState(start('Payer Name'))
  const [notes, setNotes] = useState(start('Notes'))
  const [texts, setTexts] = useState<Texts>(() => {
    const initial = {} as Texts
    for (const kind of KINDS) {
      const values = record ? filled(record, kind.field) : []
      // always at least one input to type into
      initial[kind.field] = values.length ? values : ['']
    }
    return initial
  })
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const setKind = (field: Kind['field'], values: string[]) => setTexts((current) => ({ ...current, [field]: values }))
  // a stored value outside the usual list stays selectable instead of showing as blank
  const actions = !callToAction || CALLS_TO_ACTION.includes(callToAction) ? CALLS_TO_ACTION : [callToAction, ...CALLS_TO_ACTION]

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    const fields = {
      'Preset Name': name.trim(),
      'Call to Action': callToAction,
      'Beneficiary Name': beneficiary.trim(),
      'Payer Name': payer.trim(),
      Notes: notes,
      ...Object.fromEntries(KINDS.map((kind) => Object.entries(slotFields(kind.field, texts[kind.field]))).flat()),
    }
    try {
      if (record) await api(`/data/ad_presets/${record.id}`, { method: 'PATCH', body: { fields } })
      else await api('/data/ad_presets', { method: 'POST', body: { fields: { ...fields, Product: [product.id] } } })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const control = `${input} ${readOnlyInput} mt-1.5`

  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-white shadow-xl"
        >
          <div className="flex items-center gap-3 border-b border-neutral-200 px-6 py-4">
            <Dialog.Title className="min-w-0 flex-1 truncate text-base font-semibold">
              {!record ? `Create ad preset for ${product.name}` : canEdit ? 'Edit ad preset' : text(record, 'Preset Name') || 'Untitled'}
            </Dialog.Title>
            <Dialog.Close aria-label="Close" className={button.icon}>
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="preset-name" label="Preset name">
                  <input
                    id="preset-name"
                    required
                    autoFocus={canEdit}
                    readOnly={!canEdit}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={control}
                  />
                </Field>
                <Field id="preset-cta" label="Call to action">
                  <Select
                    id="preset-cta"
                    value={callToAction || NONE}
                    options={[{ value: NONE, label: 'None' }, ...actions.map((action) => ({ value: action, label: action }))]}
                    disabled={!canEdit}
                    onValueChange={(value) => setCallToAction(value === NONE ? '' : value)}
                    className="mt-1.5 h-9.5 w-full"
                  />
                </Field>
                <Field id="preset-beneficiary" label="Beneficiary name" hint="Required on ads shown in the EU.">
                  <input id="preset-beneficiary" readOnly={!canEdit} value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} className={control} />
                </Field>
                <Field id="preset-payer" label="Payer name" hint="Required on ads shown in the EU.">
                  <input id="preset-payer" readOnly={!canEdit} value={payer} onChange={(e) => setPayer(e.target.value)} className={control} />
                </Field>
              </div>

              {KINDS.map((kind) => (
                <TextList key={kind.field} kind={kind} values={texts[kind.field]} canEdit={canEdit} onChange={(values) => setKind(kind.field, values)} />
              ))}

              <Field id="preset-notes" label="Notes">
                <textarea
                  id="preset-notes"
                  rows={3}
                  readOnly={!canEdit}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className={`${control} resize-y`}
                />
              </Field>
              {error && (
                <p role="alert" className="text-sm text-red-700">
                  {error}
                </p>
              )}
            </div>
            {canEdit && (
              <div className="flex justify-end gap-2 border-t border-neutral-200 px-6 py-3">
                <Dialog.Close type="button" className={button.secondary}>
                  Cancel
                </Dialog.Close>
                <button type="submit" disabled={busy || !name.trim()} className={button.primary}>
                  {busy ? 'Saving…' : record ? 'Save changes' : 'Create preset'}
                </button>
              </div>
            )}
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

interface TextListProps {
  kind: Kind
  values: string[]
  canEdit: boolean
  onChange: (values: string[]) => void
}

// Up to five texts of one kind, each in its own input
function TextList({ kind, values, canEdit, onChange }: TextListProps) {
  const id = (i: number) => `preset-${kind.field.toLowerCase().replace(' ', '-')}-${i + 1}`
  const set = (i: number, value: string) => onChange(values.map((old, at) => (at === i ? value : old)))
  const control = `${input} ${readOnlyInput}`

  return (
    <fieldset>
      <legend className="text-sm font-medium">
        {kind.label}{' '}
        <span className="font-normal text-neutral-500 tabular-nums">
          ({values.filter((value) => value.trim()).length} of {SLOTS})
        </span>
      </legend>
      <ul className="mt-1.5 space-y-2">
        {values.map((value, i) => (
          // inputs have no identity beyond their position
          <li key={i} className="flex items-start gap-2">
            {kind.long ? (
              <textarea
                id={id(i)}
                aria-label={`${kind.one} ${i + 1}`}
                rows={3}
                readOnly={!canEdit}
                value={value}
                onChange={(e) => set(i, e.target.value)}
                className={`${control} resize-y`}
              />
            ) : (
              <input id={id(i)} aria-label={`${kind.one} ${i + 1}`} readOnly={!canEdit} value={value} onChange={(e) => set(i, e.target.value)} className={control} />
            )}
            {canEdit && values.length > 1 && (
              <Tip label="Remove">
                <button
                  type="button"
                  aria-label={`Remove ${kind.one.toLowerCase()} ${i + 1}`}
                  onClick={() => onChange(values.filter((_, at) => at !== i))}
                  className={`${button.icon} mt-0.5 shrink-0`}
                >
                  <X className="size-4" />
                </button>
              </Tip>
            )}
          </li>
        ))}
      </ul>
      {canEdit && values.length < SLOTS && (
        <button type="button" onClick={() => onChange([...values, ''])} className={`${button.secondary} mt-2 h-7 px-2 text-xs`}>
          <Plus className="size-3.5" />
          Add {kind.one.toLowerCase()}
        </button>
      )}
    </fieldset>
  )
}
