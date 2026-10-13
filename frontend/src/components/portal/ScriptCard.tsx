import { RefreshCw, Upload, X } from 'lucide-react'
import { Progress } from 'radix-ui'
import { useRef, useState } from 'react'
import { button, StatusBadge } from '../ui'
import { statusLabel } from '../videos/VideoDetailDialog'
import { FORMATS, statusOf, TEXT_VERSIONS, type PortalVideo, type ScriptGroup } from './useEditorVideos'
import type { UploadState } from './useUploads'

interface CardProps {
  group: ScriptGroup
  // the status chip that is on, '' for none: cells in another status are dimmed
  activeStatus: string
  uploads: Map<string, UploadState>
  // whether this user may give the video a file from the grid
  mayUpload: (video: PortalVideo) => boolean
  onOpen: (video: PortalVideo) => void
  onFile: (video: PortalVideo, file: File) => void
  onCancel: (video: PortalVideo) => void
  onDismiss: (video: PortalVideo) => void
}

// One script as the editor has to make it: a cell per format and text version
export function ScriptCard({ group, ...cell }: CardProps) {
  const slot = (format: string, textVersion: string) => group.videos.filter((v) => v.format === format && v.textVersion === textVersion)
  // a video whose format or text version is not one of the usual ones still has to be shown
  const others = group.videos.filter((v) => !FORMATS.includes(v.format ?? '') || !TEXT_VERSIONS.includes(v.textVersion ?? ''))
  const done = group.videos.filter((v) => statusOf(v) !== 'To Do').length

  return (
    <article aria-label={group.scriptName} className="rounded-lg border border-neutral-200 bg-white">
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-neutral-200 px-3 py-2.5">
        <h2 className="min-w-0 flex-1 text-sm font-semibold wrap-break-word">{group.scriptName}</h2>
        {group.productName && (
          <span className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-700">{group.productName}</span>
        )}
        <span
          className={`rounded-md px-2 py-0.5 text-xs font-medium tabular-nums ring-1 ring-inset ${
            done >= group.videos.length ? 'bg-emerald-50 text-emerald-800 ring-emerald-600/20' : 'bg-neutral-100 text-neutral-700 ring-neutral-500/20'
          }`}
        >
          {done}/{group.videos.length} uploaded
        </span>
      </header>

      <div className="overflow-x-auto p-2">
        <table className="w-full table-fixed border-separate border-spacing-1 text-sm">
          <thead className="text-xs tracking-wide text-neutral-600 uppercase">
            <tr>
              <th className="w-14" />
              {FORMATS.map((format) => (
                <th key={format} scope="col" className="pb-0.5 text-center font-medium">
                  {format}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TEXT_VERSIONS.map((textVersion) => (
              <tr key={textVersion}>
                <th scope="row" className="pr-1 text-left align-middle text-xs font-medium text-neutral-600">
                  {textVersion}
                </th>
                {FORMATS.map((format) => {
                  const videos = slot(format, textVersion)
                  return (
                    <td key={format} className="space-y-1 align-top">
                      {videos.map((video) => (
                        <VideoCell key={video.id} video={video} {...cell} />
                      ))}
                      {videos.length === 0 && (
                        <div className="flex min-h-18 items-center justify-center rounded-md border border-dashed border-neutral-200 text-xs text-neutral-400">
                          Not assigned
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>

        {others.length > 0 && (
          <ul aria-label="Other videos" className="mt-1 grid grid-cols-3 gap-1 px-1">
            {others.map((video) => (
              <li key={video.id}>
                <VideoCell video={video} caption={[video.format, video.textVersion].filter(Boolean).join(' · ') || 'No format'} {...cell} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  )
}

interface CellProps extends Omit<CardProps, 'group'> {
  video: PortalVideo
  // said above the status, for a video outside the format and text grid
  caption?: string
}

// One video: its status, which opens the details, and its upload when the editor may give it a file
function VideoCell({ video, caption, activeStatus, uploads, mayUpload, onOpen, onFile, onCancel, onDismiss }: CellProps) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const status = statusOf(video)
  const name = video.name || 'Untitled'
  const upload = uploads.get(video.id)
  const uploading = upload?.progress !== undefined
  const allowed = mayUpload(video)
  const canDrop = allowed && !uploading
  const dimmed = activeStatus !== '' && activeStatus !== status && !upload

  return (
    <div
      onDragOver={(e) => {
        if (!canDrop) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        if (!canDrop) return
        e.preventDefault()
        setDragOver(false)
        // one video takes one file; a file of the wrong kind is refused with a reason
        const file = e.dataTransfer.files[0]
        if (file) onFile(video, file)
      }}
      className={`flex min-h-18 flex-col items-center justify-center gap-1 rounded-md border px-1 py-1.5 text-center ${
        dragOver ? 'border-blue-700 bg-blue-50' : 'border-neutral-200 bg-neutral-50/60'
      } ${dimmed ? 'opacity-50' : ''}`}
    >
      {caption && <span className="text-[11px] text-neutral-500">{caption}</span>}
      <button
        onClick={() => onOpen(video)}
        aria-label={`${name}: ${statusLabel(status)}. Open details`}
        className="rounded-md hover:brightness-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
      >
        <StatusBadge status={statusLabel(status)} />
      </button>

      {uploading ? (
        <div role="status" className="flex w-full items-center gap-1 px-1">
          <div className="min-w-0 flex-1">
            <Progress.Root
              value={Math.round(upload.progress! * 100)}
              aria-label={`Upload progress of ${name}`}
              className="h-1.5 overflow-hidden rounded-full bg-neutral-200"
            >
              <Progress.Indicator className="h-full rounded-full bg-blue-700 transition-[width]" style={{ width: `${upload.progress! * 100}%` }} />
            </Progress.Root>
            <p className="mt-0.5 text-[11px] text-neutral-600 tabular-nums">
              {/* the bytes are out; the record is being pointed at the file */}
              {upload.progress! >= 1 ? 'Saving…' : `${Math.round(upload.progress! * 100)}%`}
            </p>
          </div>
          <button onClick={() => onCancel(video)} aria-label={`Cancel the upload of ${name}`} className={`${button.icon} size-6`}>
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        allowed && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="video/*"
              aria-label={`Video file for ${name}`}
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onFile(video, file)
                // so the same file can be picked again after a failure
                e.target.value = ''
              }}
            />
            <button
              onClick={() => fileInput.current?.click()}
              aria-label={`${status === 'Review' ? 'Replace the file of' : 'Upload a file for'} ${name}`}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium text-blue-700 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-blue-700"
            >
              {status === 'Review' ? <RefreshCw className="size-3" /> : <Upload className="size-3" />}
              {dragOver ? 'Drop file' : status === 'Review' ? 'Replace' : 'Upload'}
            </button>
          </>
        )
      )}

      {upload?.error && (
        <p role="alert" className="flex items-start gap-1 text-left text-[11px] leading-snug text-red-700">
          <span className="min-w-0 wrap-break-word">{upload.error}</span>
          <button onClick={() => onDismiss(video)} aria-label="Dismiss the error" className="shrink-0 rounded hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-red-700">
            <X className="size-3" />
          </button>
        </p>
      )}
    </div>
  )
}
