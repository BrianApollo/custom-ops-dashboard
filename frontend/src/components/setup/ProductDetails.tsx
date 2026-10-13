import { ExternalLink, ImageOff, Plus, X } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { useFetch, useWorkspace, type Product } from '../../data'
import { api, text, type ApiRecord, type Attachment } from '../../lib/api'
import { button, input, Select, Tip } from '../ui'
import { ConfirmDelete, Field, readOnlyInput, Section } from './shared'

type AssetField = 'Product Logo' | 'Product Images'

const STATUSES = ['Active', 'Preparing', 'Benched']
// the server's limit for a product image
const MAX_BYTES = 50 * 1024 * 1024

const attachments = (record: ApiRecord, field: AssetField) => (record.fields[field] as Attachment[] | undefined) ?? []

// The storage key behind a product file's link. Product files are stored as
// `{productId}/{file name}`, and the link is the key with only % # ? escaped.
// A link of any other shape gives null: that file is not ours to delete from here.
function storedKey(url: string | undefined, productId: string) {
  const at = url?.indexOf(`/${productId}/`) ?? -1
  if (!url || at === -1) return null
  const path = url.slice(at + 1).split(/[?#]/)[0]
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

const deleteFile = (key: string) => api('/storage/delete', { method: 'POST', body: { key } })

export function ProductDetails({ product, canEdit }: { product: Product; canEdit: boolean }) {
  const { data, error } = useFetch<ApiRecord>(`/data/products/${product.id}`)

  if (!data) {
    return (
      <Section title="Product details">
        <p role={error ? 'alert' : 'status'} className={`text-sm ${error ? 'text-red-700' : 'text-neutral-500'}`}>
          {error ? `Could not load the product: ${error.message}` : 'Loading…'}
        </p>
      </Section>
    )
  }
  return <Details key={data.id} initial={data} canEdit={canEdit} />
}

function Details({ initial, canEdit }: { initial: ApiRecord; canEdit: boolean }) {
  const { reload } = useWorkspace()
  // replaced by the server's answer after every write, so it is always what is stored
  const [record, setRecord] = useState(initial)
  const [name, setName] = useState(text(initial, 'Product Name'))
  const [status, setStatus] = useState(text(initial, 'Status'))
  const [drive, setDrive] = useState(text(initial, 'Drive Link'))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string>()
  // what an upload or removal is doing right now; one at a time, as each sends the field's whole list
  const [working, setWorking] = useState<string>()
  const [assetError, setAssetError] = useState<string>()
  const [removing, setRemoving] = useState<{ field: AssetField; file: Attachment } | null>(null)

  const changes: Record<string, string> = {}
  if (name.trim() !== text(record, 'Product Name')) changes['Product Name'] = name.trim()
  if (status !== text(record, 'Status')) changes.Status = status
  if (drive.trim() !== text(record, 'Drive Link')) changes['Drive Link'] = drive.trim()
  const dirty = Object.keys(changes).length > 0

  const patch = (fields: Record<string, unknown>) => api<ApiRecord>(`/data/products/${record.id}`, { method: 'PATCH', body: { fields } })

  async function save(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setSaveError(undefined)
    try {
      setRecord(await patch(changes))
      // the picker and the page heading show the name, status and logo
      void reload()
    } catch (err) {
      setSaveError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function reset() {
    setName(text(record, 'Product Name'))
    setStatus(text(record, 'Status'))
    setDrive(text(record, 'Drive Link'))
    setSaveError(undefined)
  }

  async function upload(field: AssetField, files: File[]) {
    setAssetError(undefined)
    // files already in the bucket, to be taken out again if they never reach the product
    const stored: { key: string; url: string; filename: string }[] = []
    try {
      for (const [i, file] of files.entries()) {
        if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image`)
        if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 50 MB`)
        setWorking(files.length > 1 ? `Uploading ${i + 1} of ${files.length}…` : 'Uploading…')
        // a prefix that is new every time, so a file never overwrites one another attachment still points at
        const fileName = `${Date.now().toString(36)}${i}-${file.name.replace(/[/\\]/g, '-')}`
        const target = await api<{ uploadUrl: string; publicUrl: string; key: string }>('/storage/presign', {
          method: 'POST',
          body: { kind: 'product-image', productId: record.id, fileName, contentType: file.type, contentLength: file.size },
        })
        const put = await fetch(target.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
        if (!put.ok) throw new Error(`Storage refused ${file.name} (${put.status})`)
        stored.push({ key: target.key, url: target.publicUrl, filename: file.name })
      }
      setWorking('Saving…')
      // the whole list goes back: `{ id }` keeps a file, `{ url }` adds one
      const next = await patch({
        [field]: [...attachments(record, field).map(({ id }) => ({ id })), ...stored.map(({ url, filename }) => ({ url, filename }))],
      })
      setRecord(next)
      if (field === 'Product Logo') void reload()
    } catch (err) {
      await Promise.all(stored.map(({ key }) => deleteFile(key).catch(() => undefined)))
      setAssetError((err as Error).message)
    } finally {
      setWorking(undefined)
    }
  }

  // Takes the file off the product first, then deletes it from storage: a failure in
  // between leaves an unused file behind, never a product pointing at a missing one
  async function remove(field: AssetField, file: Attachment) {
    setAssetError(undefined)
    const next = await patch({
      [field]: attachments(record, field)
        .filter((other) => other.id !== file.id)
        .map(({ id }) => ({ id })),
    })
    setRecord(next)
    if (field === 'Product Logo') void reload()

    const key = storedKey(file.url, record.id)
    const stillUsed = [...attachments(next, 'Product Logo'), ...attachments(next, 'Product Images')].some((other) => other.url === file.url)
    if (!key || stillUsed) return
    try {
      await deleteFile(key)
    } catch (err) {
      setAssetError(`${file.filename} was removed from the product, but its stored file could not be deleted: ${(err as Error).message}`)
    }
  }

  const statuses = !status || STATUSES.includes(status) ? STATUSES : [status, ...STATUSES]
  const driveLink = text(record, 'Drive Link')

  return (
    <Section title="Product details">
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_2fr]">
          <Field id="setup-product-name" label="Name">
            <input
              id="setup-product-name"
              required
              readOnly={!canEdit}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`${input} ${readOnlyInput} mt-1.5`}
            />
          </Field>
          <Field id="setup-product-status" label="Status">
            <Select
              id="setup-product-status"
              value={status}
              options={statuses}
              placeholder="No status"
              disabled={!canEdit}
              onValueChange={setStatus}
              className="mt-1.5 h-9.5 w-full"
            />
          </Field>
          <Field id="setup-product-drive" label="Drive link">
            <div className="mt-1.5 flex items-center gap-2">
              <input
                id="setup-product-drive"
                type="url"
                placeholder={canEdit ? 'https://' : 'None'}
                readOnly={!canEdit}
                value={drive}
                onChange={(e) => setDrive(e.target.value)}
                className={`${input} ${readOnlyInput}`}
              />
              {/^https?:\/\//.test(driveLink) && (
                <Tip label="Open the saved link">
                  <a href={driveLink} target="_blank" rel="noreferrer" aria-label="Open the saved Drive link" className={`${button.icon} shrink-0`}>
                    <ExternalLink className="size-4" />
                  </a>
                </Tip>
              )}
            </div>
          </Field>
        </div>
        {saveError && (
          <p role="alert" className="text-sm text-red-700">
            {saveError}
          </p>
        )}
        {canEdit && (
          <div className="flex justify-end gap-2">
            <button type="button" disabled={!dirty || saving} onClick={reset} className={button.secondary}>
              Discard changes
            </button>
            <button type="submit" disabled={!dirty || saving || !name.trim()} className={button.primary}>
              {saving ? 'Saving…' : 'Save details'}
            </button>
          </div>
        )}
      </form>

      <div className="mt-6 grid gap-6 border-t border-neutral-200 pt-5 lg:grid-cols-2">
        <Assets
          title="Logo"
          hint="The first logo is the one shown next to the product's name."
          files={attachments(record, 'Product Logo')}
          canEdit={canEdit}
          busy={Boolean(working)}
          onAdd={(files) => void upload('Product Logo', files)}
          onRemove={(file) => setRemoving({ field: 'Product Logo', file })}
        />
        <Assets
          title="Product images"
          hint="The first image is the reference picture for image generation."
          multiple
          files={attachments(record, 'Product Images')}
          canEdit={canEdit}
          busy={Boolean(working)}
          onAdd={(files) => void upload('Product Images', files)}
          onRemove={(file) => setRemoving({ field: 'Product Images', file })}
        />
      </div>
      {working && (
        <p role="status" className="mt-3 text-sm text-neutral-500">
          {working}
        </p>
      )}
      {assetError && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {assetError}
        </p>
      )}

      {removing && (
        <ConfirmDelete
          title={`Remove ${removing.file.filename}?`}
          description="It is taken off the product and its stored file is deleted. This cannot be undone."
          confirmLabel="Remove"
          onConfirm={() => remove(removing.field, removing.file)}
          onClose={() => setRemoving(null)}
        />
      )}
    </Section>
  )
}

interface AssetsProps {
  title: string
  hint: string
  // the picker takes several files at once
  multiple?: boolean
  files: Attachment[]
  canEdit: boolean
  busy: boolean
  onAdd: (files: File[]) => void
  onRemove: (file: Attachment) => void
}

function Assets({ title, hint, multiple, files, canEdit, busy, onAdd, onRemove }: AssetsProps) {
  const picker = useRef<HTMLInputElement>(null)

  return (
    <div>
      <h3 className="text-sm font-medium">
        {title} <span className="font-normal text-neutral-500 tabular-nums">({files.length})</span>
      </h3>
      <p className="mt-0.5 text-xs text-neutral-500">{hint}</p>
      <ul className="mt-3 flex flex-wrap gap-3">
        {files.map((file) => (
          <li key={file.id} className="relative size-24 rounded-md border border-neutral-200 bg-neutral-50">
            {file.url ? (
              <a href={file.url} target="_blank" rel="noreferrer" title={file.filename} className="block size-full rounded-md focus-visible:outline-2 focus-visible:outline-blue-700">
                <img src={file.url} alt={file.filename} loading="lazy" className="size-full rounded-md object-contain" />
              </a>
            ) : (
              <span title={file.filename} className="flex size-full items-center justify-center text-neutral-400">
                <ImageOff aria-hidden className="size-5" />
                <span className="sr-only">{file.filename} has no preview</span>
              </span>
            )}
            {canEdit && (
              <button
                aria-label={`Remove ${file.filename}`}
                disabled={busy}
                onClick={() => onRemove(file)}
                className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full border border-neutral-300 bg-white text-neutral-600 shadow-sm hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-blue-700 disabled:opacity-60"
              >
                <X className="size-3.5" />
              </button>
            )}
          </li>
        ))}
        {canEdit && (
          <li>
            <button
              aria-label={`Upload to ${title.toLowerCase()}`}
              disabled={busy}
              onClick={() => picker.current?.click()}
              className="flex size-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-neutral-300 text-xs text-neutral-600 hover:border-blue-700 hover:text-blue-800 focus-visible:outline-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Plus className="size-4" />
              Upload
            </button>
            <input
              ref={picker}
              type="file"
              accept="image/*"
              multiple={multiple}
              hidden
              onChange={(e) => {
                const chosen = [...(e.target.files ?? [])]
                // cleared, so choosing the same file again still fires
                e.target.value = ''
                if (chosen.length) onAdd(chosen)
              }}
            />
          </li>
        )}
        {!canEdit && files.length === 0 && <li className="text-sm text-neutral-500">None yet.</li>}
      </ul>
    </div>
  )
}
