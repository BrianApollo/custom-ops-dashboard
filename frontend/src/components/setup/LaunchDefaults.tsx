import { Pencil, Plus, Trash2 } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useState, type FormEvent } from 'react'
import { useRecords, type Product } from '../../data'
import { api, text, type ApiRecord } from '../../lib/api'
import { CALLS_TO_ACTION, countriesFrom, locationChoice } from '../../pages/launcher/draft'
import { DataTable, type Column } from '../DataTable'
import { button, input, Select, Tip } from '../ui'
import { ConfirmDelete, Field, Section } from './shared'

// Radix Select has no empty value, so "no call to action" needs one of its own
const NONE = 'none'

// the preset's name where the saved countries are one of the presets, otherwise the codes themselves
function locationLabel(countries: string[]) {
  const { options, value } = locationChoice(countries)
  return options.find((option) => option.value === value)?.label ?? ''
}

export function LaunchDefaults({ product, canEdit }: { product: Product; canEdit: boolean }) {
  const { records, error, loading, reload } = useRecords('campaign_launch_setup', { 'where[Product]': product.id })
  // the record in the form; no record while adding one
  const [open, setOpen] = useState<{ record?: ApiRecord } | null>(null)
  const [deleting, setDeleting] = useState<ApiRecord | null>(null)

  const label = (record: ApiRecord) => text(record, 'Name') || 'Untitled'
  const columns: Column<ApiRecord>[] = [
    { header: 'Name', cell: label },
    { header: 'Ad account', cell: (record) => text(record, 'Ad Account') },
    { header: 'Pixel', cell: (record) => text(record, 'Pixel') },
    { header: 'Page', cell: (record) => text(record, 'Page') },
    { header: 'Daily budget', cell: (record) => text(record, 'Amount') },
    { header: 'Call to action', cell: (record) => text(record, 'Call to Action') },
    { header: 'Location targeting', cell: (record) => locationLabel(countriesFrom(text(record, 'Targeting'))) },
  ]
  if (canEdit) {
    columns.push({
      header: 'Actions',
      align: 'right',
      cell: (record) => (
        <span className="inline-flex">
          <Tip label="Edit">
            <button aria-label={`Edit ${label(record)}`} onClick={() => setOpen({ record })} className={button.icon}>
              <Pencil className="size-4" />
            </button>
          </Tip>
          <Tip label="Delete">
            <button aria-label={`Delete ${label(record)}`} onClick={() => setDeleting(record)} className={button.icon}>
              <Trash2 className="size-4" />
            </button>
          </Tip>
        </span>
      ),
    })
  }

  return (
    <Section
      title="Launch defaults"
      hint="Starting values for this product's campaigns. Templates saved from the campaign launcher are listed here too."
      action={
        canEdit && (
          <button onClick={() => setOpen({})} className={button.primary}>
            <Plus className="size-4" />
            Add launch defaults
          </button>
        )
      }
    >
      <DataTable
        columns={columns}
        rows={records ?? []}
        rowKey={(record) => record.id}
        empty={error ? `Could not load the launch defaults: ${error}` : loading ? 'Loading…' : 'This product has no launch defaults yet.'}
        emptyIsError={Boolean(error)}
      />

      {open && (
        <LaunchDefaultsDialog
          record={open.record}
          product={product}
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
          description="Campaigns already created keep their own settings. This cannot be undone."
          onConfirm={async () => {
            await api(`/data/campaign_launch_setup/${deleting.id}`, { method: 'DELETE' })
            reload()
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </Section>
  )
}

interface DialogProps {
  // none when adding
  record?: ApiRecord
  product: Product
  onClose: () => void
  onSaved: () => void
}

function LaunchDefaultsDialog({ record, product, onClose, onSaved }: DialogProps) {
  const start = (field: string) => (record ? text(record, field) : '')
  const [name, setName] = useState(start('Name'))
  const [adAccount, setAdAccount] = useState(start('Ad Account'))
  const [pixel, setPixel] = useState(start('Pixel'))
  const [page, setPage] = useState(start('Page'))
  const [amount, setAmount] = useState(start('Amount'))
  const [callToAction, setCallToAction] = useState(start('Call to Action'))
  const [countries, setCountries] = useState(countriesFrom(start('Targeting')))
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  // a stored value outside the usual list stays selectable instead of showing as blank
  const actions = !callToAction || CALLS_TO_ACTION.includes(callToAction) ? CALLS_TO_ACTION : [callToAction, ...CALLS_TO_ACTION]

  const location = locationChoice(countries)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    // every field is sent, so clearing one clears it in the record
    const fields = {
      Name: name.trim(),
      'Ad Account': adAccount.trim(),
      Pixel: pixel.trim(),
      Page: page.trim(),
      Amount: amount.trim(),
      'Call to Action': callToAction,
      Targeting: countries.join(','),
    }
    try {
      if (record) await api(`/data/campaign_launch_setup/${record.id}`, { method: 'PATCH', body: { fields } })
      else await api('/data/campaign_launch_setup', { method: 'POST', body: { fields: { ...fields, Product: [product.id] } } })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const control = `${input} mt-1.5`

  return (
    <Dialog.Root open onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-white shadow-xl"
        >
          <Dialog.Title className="border-b border-neutral-200 px-6 py-4 text-base font-semibold">
            {record ? 'Edit launch defaults' : `Add launch defaults for ${product.name}`}
          </Dialog.Title>
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
              <Field id="launch-name" label="Name" hint="Tells one set of defaults from another.">
                <input id="launch-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} className={control} />
              </Field>
              <Field id="launch-ad-account" label="Ad account ID">
                <input id="launch-ad-account" value={adAccount} onChange={(e) => setAdAccount(e.target.value)} className={control} />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="launch-pixel" label="Pixel ID">
                  <input id="launch-pixel" value={pixel} onChange={(e) => setPixel(e.target.value)} className={control} />
                </Field>
                <Field id="launch-page" label="Page ID">
                  <input id="launch-page" value={page} onChange={(e) => setPage(e.target.value)} className={control} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="launch-amount" label="Daily budget (USD)">
                  <input id="launch-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={control} />
                </Field>
                <Field id="launch-cta" label="Call to action">
                  <Select
                    id="launch-cta"
                    value={callToAction || NONE}
                    options={[{ value: NONE, label: 'None' }, ...actions.map((action) => ({ value: action, label: action }))]}
                    onValueChange={(value) => setCallToAction(value === NONE ? '' : value)}
                    className="mt-1.5 h-9.5 w-full"
                  />
                </Field>
              </div>
              <Field id="launch-targeting" label="Location targeting">
                <Select
                  id="launch-targeting"
                  value={location.value || NONE}
                  options={[{ value: NONE, label: 'None' }, ...location.options]}
                  onValueChange={(value) => setCountries(value === NONE ? [] : value.split(','))}
                  className="mt-1.5 h-9.5 w-full"
                />
              </Field>
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
              <button type="submit" disabled={busy} className={button.primary}>
                {busy ? 'Saving…' : record ? 'Save changes' : 'Add launch defaults'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
