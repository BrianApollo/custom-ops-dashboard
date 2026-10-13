import { api, type ApiRecord } from './api'

// Uploading a video file for a Videos or AI Videos record. The browser asks our API where to put
// the file (`POST /storage/presign`), sends it straight to storage, then points the record at it.
//
// Typical use, from any screen that shows a video:
//
//   const record = await uploadVideoFile({
//     kind: 'video',
//     video: { id, name, productId, creativeLink, videoData },
//     file,
//     onProgress: (fraction) => setProgress(fraction),
//   })
//
// The server allows it for admins and for the editor the video is assigned to.

// `video` is a row of Videos, `ai-video` a row of AI Videos
export type VideoKind = 'video' | 'ai-video'

// What is stored in a record's `Video Data` field, as JSON text
export interface VideoData {
  firstUploadedAt: string
  lastUploadedAt: string
  durationSeconds?: number
  // `M:SS`, or `H:MM:SS` from an hour up
  durationFormatted?: string
  width?: number
  height?: number
  fileSizeBytes: number
  mimeType: string
  originalFileName: string
  extractedAt: string
}

export interface StoredFile {
  // where the file can be watched or downloaded
  publicUrl: string
  // its key in the bucket, as `/storage/delete` wants it
  key: string
}

// A video may receive a file while it waits for one (To Do) or waits for review (Review)
export const UPLOAD_STATUSES = ['To Do', 'Review']

const TABLES: Record<VideoKind, string> = { video: 'videos', 'ai-video': 'ai_videos' }

const METADATA_TIMEOUT_MS = 10_000

// the lowercased text after the last dot, '' when the name has none
export function fileExtension(fileName: string) {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 && dot < fileName.length - 1 ? fileName.slice(dot + 1).toLowerCase() : ''
}

// Files are stored under the record's name, never the name the file had on the editor's computer:
// `{Product}/Videos/{Video Name}.{ext}`. The server adds the product and folder.
export function videoFileName(videoName: string, file: File) {
  const extension = fileExtension(file.name)
  if (!extension) throw new Error(`${file.name} has no file extension, so its format cannot be told`)
  if (!file.type.startsWith('video/')) throw new Error(`${file.name} is not a video file`)
  // the server refuses slashes and control characters in a file name
  const safe = videoName.trim().replace(/[/\\\u0000-\u001f]/g, '-')
  if (!safe) throw new Error('The video has no name to store the file under')
  return `${safe}.${extension}`
}

function formatDuration(seconds: number) {
  const whole = Math.round(seconds)
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const s = String(whole % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

// Duration and frame size, read by the browser from the file itself. Resolves to {} for a file
// the browser cannot open, so an unusual codec never blocks an upload.
export function readVideoMetadata(file: File): Promise<Pick<VideoData, 'durationSeconds' | 'durationFormatted' | 'width' | 'height'>> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const element = document.createElement('video')
    const finish = (result: Pick<VideoData, 'durationSeconds' | 'durationFormatted' | 'width' | 'height'>) => {
      clearTimeout(timer)
      URL.revokeObjectURL(url)
      resolve(result)
    }
    const timer = setTimeout(() => finish({}), METADATA_TIMEOUT_MS)
    element.preload = 'metadata'
    element.onloadedmetadata = () => {
      const seconds = Number.isFinite(element.duration) ? element.duration : undefined
      finish({
        durationSeconds: seconds,
        durationFormatted: seconds === undefined ? undefined : formatDuration(seconds),
        width: element.videoWidth || undefined,
        height: element.videoHeight || undefined,
      })
    }
    element.onerror = () => finish({})
    element.src = url
  })
}

interface StoreOptions {
  kind: VideoKind
  // the product whose folder the file goes into
  productId: string
  // the name to store it under, extension included (see `videoFileName`)
  fileName: string
  file: File
  // called with 0 to 1 as the bytes go out
  onProgress?: (fraction: number) => void
  // aborting it cancels the transfer; the promise then rejects with an AbortError
  signal?: AbortSignal
}

// Sends one file to storage and returns where it ended up. Writes nothing to the database.
// A file already stored under the same name is replaced.
export async function storeVideoFile({ kind, productId, fileName, file, onProgress, signal }: StoreOptions): Promise<StoredFile> {
  const target = await api<StoredFile & { uploadUrl: string }>('/storage/presign', {
    method: 'POST',
    body: { kind, productId, fileName, contentType: file.type, contentLength: file.size },
  })

  // XMLHttpRequest, because fetch cannot report how much of a request body has been sent
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', target.uploadUrl)
    // the type is part of the signed link, so it must be sent exactly as it was signed
    request.setRequestHeader('Content-Type', file.type)
    request.upload.onprogress = (event) => event.lengthComputable && onProgress?.(event.loaded / event.total)
    request.onload = () =>
      request.status >= 200 && request.status < 300 ? resolve() : reject(new Error(`Storage refused the file (${request.status})`))
    request.onerror = () => reject(new Error('The upload was interrupted. Check the connection and try again.'))
    request.onabort = () => reject(new DOMException('The upload was cancelled', 'AbortError'))
    signal?.addEventListener('abort', () => request.abort(), { once: true })
    if (signal?.aborted) request.abort()
    else request.send(file)
  })
  onProgress?.(1)

  return { publicUrl: target.publicUrl, key: target.key }
}

// The bucket key behind one of our own public links, null for a link that points anywhere else.
// `sample` is any file just stored, which shows how the server writes a key into a link.
function keyOf(link: string, sample: StoredFile) {
  const encode = (key: string) => key.replace(/[%#?]/g, (c) => encodeURIComponent(c))
  const path = encode(sample.key)
  if (!sample.publicUrl.endsWith(path)) return null
  const base = sample.publicUrl.slice(0, -path.length)
  if (!link.startsWith(base)) return null
  const rest = link.slice(base.length).split(/[?#]/)[0]
  try {
    return decodeURIComponent(rest)
  } catch {
    return rest
  }
}

function parseVideoData(raw: string | null | undefined): Partial<VideoData> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Partial<VideoData>) : {}
  } catch {
    return {}
  }
}

// What to write to a record's `Video Data` for a file uploaded now. `previous` is the record's
// current Video Data, whose first upload time is kept.
export async function describeVideoFile(file: File, previous?: string | null): Promise<VideoData> {
  const metadata = await readVideoMetadata(file)
  const now = new Date().toISOString()
  return {
    firstUploadedAt: parseVideoData(previous).firstUploadedAt ?? now,
    lastUploadedAt: now,
    ...metadata,
    fileSizeBytes: file.size,
    mimeType: file.type,
    originalFileName: file.name,
    extractedAt: now,
  }
}

interface UploadOptions {
  kind: VideoKind
  video: {
    id: string
    // the record's `Video Name`; the file is stored under it
    name: string
    productId: string
    // the record's current `Creative Link`, if it has a file already
    creativeLink?: string | null
    // the record's current `Video Data`, so the first upload time is kept on a replace
    videoData?: string | null
  }
  file: File
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

// Uploads or replaces a video's file: stores it, then sets the record's Creative Link and Video
// Data and moves it to Review (also when it already was in Review). Returns the updated record.
// Throws with a readable message when the file is unusable or a step fails; when the file was
// stored but the record could not be updated, calling it again is safe.
export async function uploadVideoFile({ kind, video, file, onProgress, signal }: UploadOptions): Promise<ApiRecord> {
  const fileName = videoFileName(video.name, file)
  const [stored, data] = await Promise.all([
    storeVideoFile({ kind, productId: video.productId, fileName, file, onProgress, signal }),
    describeVideoFile(file, video.videoData),
  ])
  const record = await api<ApiRecord>(`/data/${TABLES[kind]}/${video.id}`, {
    method: 'PATCH',
    body: { fields: { 'Creative Link': stored.publicUrl, Status: 'Review', 'Video Data': JSON.stringify(data) } },
  })

  // A replacement with the same extension overwrote the old file. With another extension the
  // old file is left behind under its own key, so it is removed, but only once the record
  // points at the new one. A file that cannot be removed is not worth failing the upload for.
  const oldKey = video.creativeLink ? keyOf(video.creativeLink, stored) : null
  if (oldKey && oldKey !== stored.key) {
    await api('/storage/delete', { method: 'POST', body: { key: oldKey } }).catch(() => undefined)
  }
  return record
}
