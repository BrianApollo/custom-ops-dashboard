import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../auth'
import { api, ApiError, text, type ApiRecord } from '../../lib/api'
import { fileExtension, UPLOAD_STATUSES, uploadVideoFile } from '../../lib/videoUpload'
import { statusLabel } from '../videos/VideoDetailDialog'

// One video's upload: `progress` (0 to 1) while it is going, `error` once it has failed
export interface UploadState {
  progress?: number
  error?: string
}

// the server's limit for a video file (`backend/src/routes/storage.ts`)
const MAX_BYTES = 5000 * 1024 * 1024

const gigabytes = (bytes: number) => `${(bytes / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })} GB`

// Why a file cannot be uploaded, said before anything is sent; undefined for a file that can
function refusal(file: File) {
  if (!file.type.startsWith('video/')) return `“${file.name}” is not a video file. Choose a video, such as an .mp4 or .mov.`
  if (!fileExtension(file.name)) return `“${file.name}” has no file extension, so its format cannot be told.`
  if (file.size === 0) return `“${file.name}” is empty.`
  if (file.size > MAX_BYTES) return `“${file.name}” is ${gigabytes(file.size)}. The largest video that can be uploaded is ${gigabytes(MAX_BYTES)}.`
  return undefined
}

// Uploads started from the grid, any number at once (one per video). They live above the cards,
// so turning the page or filtering does not lose them.
export function useUploads(onUploaded: () => void) {
  const { user, expire } = useAuth()
  const [states, setStates] = useState<Map<string, UploadState>>(new Map())
  const transfers = useRef(new Map<string, AbortController>())

  // leaving the page stops what is still going
  useEffect(() => {
    const running = transfers.current
    return () => running.forEach((controller) => controller.abort())
  }, [])

  function set(videoId: string, state: UploadState | null) {
    setStates((previous) => {
      const next = new Map(previous)
      if (state) next.set(videoId, state)
      else next.delete(videoId)
      return next
    })
  }

  async function start(videoId: string, file: File) {
    if (transfers.current.has(videoId)) return
    const refused = refusal(file)
    if (refused) return set(videoId, { error: refused })

    const controller = new AbortController()
    transfers.current.set(videoId, controller)
    set(videoId, { progress: 0 })
    try {
      // The list may be minutes old and has no Video Data, so the record is read first: a file
      // is stored under the video's name before the record is touched, and must not overwrite
      // the file of a video that was accepted or reassigned in the meantime.
      const record = await api<ApiRecord>(`/data/videos/${videoId}`)
      if (controller.signal.aborted) throw new DOMException('The upload was cancelled', 'AbortError')
      const status = text(record, 'Status') || 'To Do'
      if (!UPLOAD_STATUSES.includes(status)) throw new Error(`This video is now ${statusLabel(status)}, so its file can no longer be changed.`)
      if (user?.role !== 'admin' && (record.fields.Editor as string[] | undefined)?.[0] !== user?.id) {
        throw new Error('This video is no longer assigned to you.')
      }
      const productId = (record.fields.Product as string[] | undefined)?.[0]
      if (!productId) throw new Error('This video has no product, so there is no folder to store its file in.')

      await uploadVideoFile({
        kind: 'video',
        video: {
          id: videoId,
          name: text(record, 'Video Name'),
          productId,
          creativeLink: text(record, 'Creative Link'),
          videoData: text(record, 'Video Data'),
        },
        file,
        onProgress: (progress) => set(videoId, { progress }),
        signal: controller.signal,
      })
      set(videoId, null)
      onUploaded()
    } catch (err) {
      if ((err as Error).name === 'AbortError') set(videoId, null)
      else if (err instanceof ApiError && err.status === 401) expire()
      else set(videoId, { error: `Could not upload “${file.name}”: ${(err as Error).message}` })
    } finally {
      transfers.current.delete(videoId)
    }
  }

  return {
    states,
    start,
    cancel: (videoId: string) => transfers.current.get(videoId)?.abort(),
    // clears a failed upload's message
    dismiss: (videoId: string) => set(videoId, null),
  }
}
