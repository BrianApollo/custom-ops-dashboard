import { Check, Copy, ExternalLink, Undo2, Upload, X } from 'lucide-react'
import { Dialog, Label, Progress } from 'radix-ui'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '../../auth'
import { useFetch, useWorkspace } from '../../data'
import { api, text, type ApiRecord } from '../../lib/api'
import { UPLOAD_STATUSES, uploadVideoFile, type VideoData, type VideoKind } from '../../lib/videoUpload'
import { button, input, StatusBadge } from '../ui'

interface Props {
  videoId: string
  // a row of Videos or of AI Videos
  kind: VideoKind
  onClose: () => void
  // the record was changed here, so a list showing it should load again
  onChanged: () => void
}

// The data says `Review`; people read it as a step, `In Review`
export const statusLabel = (status: string) => (status === 'Review' ? 'In Review' : status)

const isUrl = (value: string) => /^https?:\/\//.test(value)
const first = (record: ApiRecord, field: string) => (record.fields[field] as string[] | undefined)?.[0]

const ASPECT: Record<string, string> = { Vertical: 'aspect-[9/16]', Square: 'aspect-square' }

function megabytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`
}

function videoData(record: ApiRecord): Partial<VideoData> {
  try {
    const parsed: unknown = JSON.parse(text(record, 'Video Data') || '{}')
    return typeof parsed === 'object' && parsed !== null ? (parsed as Partial<VideoData>) : {}
  } catch {
    return {}
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-neutral-900">{children || <span className="text-neutral-400">—</span>}</dd>
    </div>
  )
}

// One video: its details, script and file, the upload for whoever makes it, and the review
// (accept or send back) for admins
export function VideoDetailDialog({ videoId, kind, onClose, onChanged }: Props) {
  const { user } = useAuth()
  const { products, userNames } = useWorkspace()
  const table = kind === 'video' ? 'videos' : 'ai_videos'
  const { data: record, error: loadError, reload } = useFetch<ApiRecord>(`/data/${table}/${videoId}`)

  // undefined until the notes are typed in, so they start from what is saved
  const [notes, setNotes] = useState<string>()
  const [busy, setBusy] = useState<'upload' | 'status' | 'notes' | null>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string>()
  const [copied, setCopied] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const transfer = useRef<AbortController>(null)

  // closing the dialog stops an upload that is still going
  useEffect(() => () => transfer.current?.abort(), [])

  const usedIn = (record?.fields['Used In Campaign'] as string[] | undefined) ?? []
  const linkField = kind === 'video' ? 'Videos Used In This Campaign' : 'Videos copy'
  const campaigns = useFetch<{ records: ApiRecord[] }>(
    usedIn.length ? `/data/campaigns?${new URLSearchParams({ fields: 'Name', [`where[${linkField}]`]: videoId })}` : null,
  )

  const frame = 'fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-white shadow-xl'

  if (!record) {
    return (
      <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
          <Dialog.Content aria-describedby={undefined} className={frame}>
            <div className="flex items-center gap-3 border-b border-neutral-200 px-6 py-4">
              <Dialog.Title className="min-w-0 flex-1 truncate text-base font-semibold">Video</Dialog.Title>
              <Dialog.Close aria-label="Close" className={button.icon}>
                <X className="size-4" />
              </Dialog.Close>
            </div>
            <p className={`px-6 py-10 text-center text-sm ${loadError ? 'text-red-700' : 'text-neutral-500'}`}>
              {loadError ? `Could not load the video: ${loadError.message}` : 'Loading…'}
            </p>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    )
  }

  const name = text(record, 'Video Name') || 'Untitled'
  const status = text(record, 'Status')
  const format = text(record, 'Format')
  const link = text(record, 'Creative Link')
  const productId = first(record, 'Product')
  const editorId = first(record, 'Editor')
  // a scripted video shows its script's text; an AI video names its script in a text field
  const script = kind === 'video' ? (first(record, 'Script Content (from Script)') ?? '') : text(record, 'Script')
  const data = videoData(record)
  const savedNotes = text(record, 'Notes')

  const isAdmin = user?.role === 'admin'
  // the server lets an editor change only the videos assigned to them
  const mayChange = isAdmin || (Boolean(editorId) && editorId === user?.id)
  const mayUpload = mayChange && UPLOAD_STATUSES.includes(status)
  const mayReview = isAdmin && status === 'Review'

  function changed() {
    reload()
    onChanged()
  }

  async function upload(file: File | undefined) {
    if (!file || !record || busy) return
    if (!productId) return setError('This video has no product, so there is no folder to store its file in.')
    const controller = new AbortController()
    transfer.current = controller
    setBusy('upload')
    setProgress(0)
    setError(undefined)
    try {
      await uploadVideoFile({
        kind,
        video: { id: record.id, name, productId, creativeLink: link, videoData: text(record, 'Video Data') },
        file,
        onProgress: setProgress,
        signal: controller.signal,
      })
      changed()
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError(`Could not upload: ${(err as Error).message}`)
    } finally {
      transfer.current = null
      setBusy(null)
    }
  }

  async function patch(fields: Record<string, unknown>, doing: 'status' | 'notes') {
    setBusy(doing)
    setError(undefined)
    try {
      await api(`/data/${table}/${videoId}`, { method: 'PATCH', body: { fields } })
      changed()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(script)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content aria-describedby={undefined} className={frame}>
          <div className="flex items-center gap-3 border-b border-neutral-200 px-6 py-4">
            <Dialog.Title className="min-w-0 flex-1 truncate text-base font-semibold">{name}</Dialog.Title>
            <StatusBadge status={statusLabel(status)} />
            <Dialog.Close aria-label="Close" className={button.icon}>
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div
            className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-4 text-sm"
            // a video file can be dropped anywhere on the dialog
            onDragOver={(e) => mayUpload && e.preventDefault()}
            onDrop={(e) => {
              if (!mayUpload) return
              e.preventDefault()
              void upload([...e.dataTransfer.files].find((file) => file.type.startsWith('video/')))
            }}
          >
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
              <Field label="Product">{products.find((p) => p.id === productId)?.name}</Field>
              <Field label="Editor">{userNames.get(editorId ?? '')}</Field>
              <Field label="Format">{[format, text(record, 'Text Version')].filter(Boolean).join(' · ')}</Field>
              <Field label="Assigned">{new Date(record.createdTime).toLocaleDateString()}</Field>
              <Field label="Last upload">{data.lastUploadedAt && new Date(data.lastUploadedAt).toLocaleString()}</Field>
              <Field label="File">
                {[data.durationFormatted, data.width && data.height && `${data.width}×${data.height}`, data.fileSizeBytes && megabytes(data.fileSizeBytes)]
                  .filter(Boolean)
                  .join(' · ')}
              </Field>
            </dl>

            {link && (
              <section aria-label="Video file">
                {isUrl(link) ? (
                  <>
                    {/* the link is the same after a replace with the same extension, so the upload time keeps the player from showing the old file */}
                    <video
                      key={data.lastUploadedAt}
                      controls
                      preload="metadata"
                      src={link}
                      className={`mx-auto max-h-80 rounded-md bg-black ${ASPECT[format] ?? 'aspect-video'}`}
                    />
                    <a
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-blue-700 underline-offset-2 hover:underline"
                    >
                      <ExternalLink className="size-3.5" />
                      Open the file
                    </a>
                  </>
                ) : (
                  <p className="break-all text-neutral-700">{link}</p>
                )}
              </section>
            )}

            {mayUpload && (
              <section aria-label="Upload" className="rounded-md border border-dashed border-neutral-300 px-4 py-4 text-center">
                <input
                  ref={fileInput}
                  type="file"
                  accept="video/*"
                  aria-label="Video file"
                  className="sr-only"
                  onChange={(e) => {
                    void upload(e.target.files?.[0])
                    // so the same file can be picked again after a failure
                    e.target.value = ''
                  }}
                />
                {busy === 'upload' ? (
                  <div role="status">
                    <Progress.Root value={Math.round(progress * 100)} aria-label="Upload progress" className="h-1.5 overflow-hidden rounded-full bg-neutral-200">
                      <Progress.Indicator className="h-full rounded-full bg-blue-700 transition-[width]" style={{ width: `${progress * 100}%` }} />
                    </Progress.Root>
                    <p className="mt-2 text-neutral-600 tabular-nums">Uploading… {Math.round(progress * 100)}%</p>
                  </div>
                ) : (
                  <>
                    <button onClick={() => fileInput.current?.click()} disabled={busy !== null} className={link ? button.secondary : button.primary}>
                      <Upload className="size-4" />
                      {link ? 'Replace video' : 'Upload video'}
                    </button>
                    <p className="mt-2 text-xs text-neutral-500">
                      Or drop a video file here. It is stored as “{name}” and the video goes to review.
                    </p>
                  </>
                )}
              </section>
            )}

            <section>
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Script</h3>
                {script && (
                  <button onClick={copy} className={`${button.secondary} h-7 px-2 text-xs`}>
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                )}
              </div>
              {script ? (
                <p className="mt-1.5 max-h-56 overflow-y-auto rounded-md bg-neutral-50 px-3 py-2 leading-relaxed whitespace-pre-wrap text-neutral-800">
                  {script}
                </p>
              ) : (
                <p className="mt-1.5 text-neutral-500">No script text.</p>
              )}
            </section>

            <section>
              <Label.Root htmlFor="video-notes" className="text-sm font-medium">
                Notes
              </Label.Root>
              {mayChange ? (
                <>
                  <textarea
                    id="video-notes"
                    rows={3}
                    placeholder="Feedback for the editor, or anything the reviewer should know"
                    value={notes ?? savedNotes}
                    onChange={(e) => setNotes(e.target.value)}
                    // saved on leaving the field, as there is no Save button
                    onBlur={() => notes !== undefined && notes !== savedNotes && void patch({ Notes: notes }, 'notes')}
                    className={`${input} mt-1.5 resize-y`}
                  />
                  <p className="mt-1 h-4 text-xs text-neutral-500" aria-live="polite">
                    {busy === 'notes' ? 'Saving…' : notes !== undefined && notes === savedNotes ? 'Saved' : ''}
                  </p>
                </>
              ) : (
                <p id="video-notes" className="mt-1.5 whitespace-pre-wrap text-neutral-700">
                  {savedNotes || <span className="text-neutral-500">No notes.</span>}
                </p>
              )}
            </section>

            {usedIn.length > 0 && (
              <section>
                <h3 className="text-sm font-medium">Used in</h3>
                <p className="mt-1.5 text-neutral-700">
                  {campaigns.data
                    ? campaigns.data.records.map((campaign) => text(campaign, 'Name') || 'Untitled').join(', ')
                    : `${usedIn.length.toLocaleString()} ${usedIn.length === 1 ? 'campaign' : 'campaigns'}`}
                </p>
              </section>
            )}

            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
          </div>

          {mayReview && (
            <div className="flex items-center justify-end gap-2 border-t border-neutral-200 px-6 py-3">
              <p className="mr-auto text-xs text-neutral-500">Sending it back returns the video to To Do. Say why in the notes.</p>
              <button onClick={() => patch({ Status: 'To Do' }, 'status')} disabled={busy !== null} className={button.secondary}>
                <Undo2 className="size-4" />
                Reject
              </button>
              <button
                onClick={() => patch({ Status: 'Available' }, 'status')}
                disabled={busy !== null}
                // the primary button in green, to set it apart from Reject
                className="inline-flex items-center justify-center gap-1.5 rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-500"
              >
                <Check className="size-4" />
                Accept
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
