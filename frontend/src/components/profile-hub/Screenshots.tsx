import { FileText, Trash2, Upload, X } from 'lucide-react'
import { AlertDialog, Dialog } from 'radix-ui'
import { useRef, useState } from 'react'
import { useAuth } from '../../auth'
import { api, ApiError, type ApiRecord, type Attachment } from '../../lib/api'
import { button, Tip } from '../ui'

// what the server accepts for kind `profile`
const ALLOWED = /^(image\/|application\/pdf$)/
const MAX_BYTES = 25 * 1024 * 1024

// a file added moments ago has no stored type yet, so the name decides too
const isImage = (file: Attachment) => (file.type ?? '').startsWith('image/') || /\.(png|jpe?g|webp|gif|avif)$/i.test(file.filename)

interface Props {
  profileId: string
  // the attachment field, e.g. `SOP 7 Screenshot`
  field: string
  hint: string
  files: Attachment[]
  // the record as stored after an upload or a removal
  onSaved: (record: ApiRecord) => void
}

// Proof screenshots for one stage. Uploads and removals are stored at once,
// on their own, so they never touch the unsaved edits of any box.
export function Screenshots({ profileId, field, hint, files, onSaved }: Props) {
  const { expire } = useAuth()
  const picker = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [preview, setPreview] = useState<Attachment>()
  const [removing, setRemoving] = useState<Attachment>()

  function failed(err: unknown) {
    if (err instanceof ApiError && err.status === 401) expire()
    else setError((err as Error).message)
  }

  // the field is written as its whole list: `{ id }` keeps a file, `{ url, filename }` adds one
  const write = (list: unknown[]) => api<ApiRecord>(`/data/profiles/${profileId}`, { method: 'PATCH', body: { fields: { [field]: list } } })

  async function upload(chosen: File[]) {
    setError(undefined)
    let kept = files.map((file) => ({ id: file.id }))
    try {
      for (const file of chosen) {
        if (!ALLOWED.test(file.type)) throw new Error(`${file.name} is not an image or a PDF`)
        if (file.size > MAX_BYTES) throw new Error(`${file.name} is larger than 25 MB`)
        setBusy(`Uploading ${file.name}…`)
        const target = await api<{ uploadUrl: string; publicUrl: string }>('/storage/presign', {
          method: 'POST',
          body: {
            kind: 'profile',
            profileId,
            field,
            // the name becomes part of the file's address
            fileName: file.name.replace(/[^\w.-]+/g, '_'),
            contentType: file.type,
            contentLength: file.size,
          },
        })
        const put = await fetch(target.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
        if (!put.ok) throw new Error(`Storage refused ${file.name} (${put.status})`)
        const record = await write([...kept, { url: target.publicUrl, filename: file.name }])
        kept = ((record.fields[field] as Attachment[] | undefined) ?? []).map((stored) => ({ id: stored.id }))
        onSaved(record)
      }
    } catch (err) {
      failed(err)
    } finally {
      setBusy(undefined)
    }
  }

  async function remove(file: Attachment) {
    setRemoving(undefined)
    setError(undefined)
    setBusy(`Removing ${file.filename}…`)
    try {
      onSaved(await write(files.filter((other) => other.id !== file.id).map((other) => ({ id: other.id }))))
    } catch (err) {
      failed(err)
    } finally {
      setBusy(undefined)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <span className="text-sm font-medium">Screenshots</span>
          <span className="ml-2 text-xs text-neutral-500">{hint}. Images or PDF, up to 25 MB each.</span>
        </div>
        <button type="button" disabled={Boolean(busy)} onClick={() => picker.current?.click()} className={button.secondary}>
          <Upload className="size-4" />
          Upload
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          accept="image/*,application/pdf"
          aria-label={`Upload ${field}`}
          onChange={(e) => {
            const chosen = [...(e.target.files ?? [])]
            // cleared so the same file can be chosen again after a failure
            e.target.value = ''
            if (chosen.length) void upload(chosen)
          }}
        />
      </div>

      {files.length === 0 ? (
        <p className="mt-2 rounded-md border border-dashed border-neutral-300 px-3 py-4 text-center text-sm text-neutral-500">No screenshots yet.</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-3">
          {files.map((file) => (
            <li key={file.id} className="relative w-32">
              {isImage(file) && file.url ? (
                <button
                  type="button"
                  onClick={() => setPreview(file)}
                  aria-label={`Preview ${file.filename}`}
                  className="block size-32 overflow-hidden rounded-md border border-neutral-200 bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                >
                  <img src={file.url} alt="" loading="lazy" className="size-full object-cover" />
                </button>
              ) : (
                <a
                  href={file.url}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`Open ${file.filename}`}
                  className="flex size-32 items-center justify-center rounded-md border border-neutral-200 bg-neutral-50 text-neutral-500 hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                >
                  <FileText className="size-8" />
                </a>
              )}
              <Tip label="Remove">
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  aria-label={`Remove ${file.filename}`}
                  onClick={() => setRemoving(file)}
                  className="absolute top-1 right-1 flex size-6 items-center justify-center rounded bg-white/90 text-neutral-700 shadow-sm ring-1 ring-neutral-300 hover:bg-white hover:text-red-700 focus-visible:outline-2 focus-visible:outline-blue-700 disabled:opacity-60"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </Tip>
              <span className="mt-1 block truncate text-xs text-neutral-600" title={file.filename}>
                {file.filename}
              </span>
            </li>
          ))}
        </ul>
      )}

      {busy && <p className="mt-2 text-sm text-neutral-600">{busy}</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <Dialog.Root open={preview !== undefined} onOpenChange={(open) => !open && setPreview(undefined)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-white shadow-xl"
          >
            <div className="flex items-center justify-between gap-4 border-b border-neutral-200 px-4 py-3">
              <Dialog.Title className="truncate text-sm font-semibold">{preview?.filename}</Dialog.Title>
              <Dialog.Close aria-label="Close" className={button.icon}>
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-neutral-100 p-4">
              {preview && <img src={preview.url} alt={preview.filename} className="mx-auto max-w-full" />}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <AlertDialog.Root open={removing !== undefined} onOpenChange={(open) => !open && setRemoving(undefined)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl">
            <AlertDialog.Title className="text-base font-semibold">Remove this screenshot?</AlertDialog.Title>
            <AlertDialog.Description className="mt-2 text-sm wrap-break-word text-neutral-600">
              {removing?.filename} will be taken off this profile.
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Cancel className={button.secondary}>Cancel</AlertDialog.Cancel>
              <AlertDialog.Action
                onClick={() => removing && void remove(removing)}
                className="inline-flex items-center justify-center rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-700"
              >
                Remove
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  )
}
