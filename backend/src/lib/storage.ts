import { AwsClient } from 'aws4fetch'
import { settings } from '../env'
import { ApiError, invalid } from './errors'

const UPLOAD_SECONDS = 600

const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/')

function publicBase() {
  const base = settings.PUBLIC_FILES_URL
  if (!base) throw new ApiError(503, 'not_configured', 'PUBLIC_FILES_URL is not set on the server')
  return base.replace(/\/$/, '')
}

// The key goes into the link as is, spaces included, because that is how every
// link already stored in the data is written (`…/GhostWing/Videos/GhostWing - Script 1039 - ….mp4`).
// Only the three characters that would change the meaning of the URL are escaped;
// Airtable file names, for one, contain a literal `%20`.
export const urlPath = (key: string) => key.replace(/[%#?]/g, (c) => encodeURIComponent(c))

export const publicUrl = (key: string) => `${publicBase()}/${urlPath(key)}`

// The object key behind one of our own public URLs, written either way.
// Anything else is refused, so a record can only point at files in our bucket.
export function keyFromUrl(url: unknown, field: string) {
  const prefix = `${publicBase()}/`
  if (typeof url !== 'string' || !url.startsWith(prefix)) {
    throw invalid(`${field} files must be uploaded to ${prefix}`, field)
  }
  const path = url.slice(prefix.length).split(/[?#]/)[0]
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

// Stored links are written with raw spaces; this is the same address as a
// proper URL, with each character encoded exactly once
const asUrl = (base: string, key: string) => `${base}/${key.split('/').map(encodeURIComponent).join('/')}`

// A file handed to Facebook to download must be one of ours. Returns its
// address on the main domain and, when one is configured, on the bucket's
// r2.dev address, which is tried if Facebook cannot fetch the first.
export function ownFile(url: unknown, field: string) {
  const fallbackBase = settings.STORAGE_FALLBACK_URL?.replace(/\/$/, '')
  if (fallbackBase && typeof url === 'string' && url.startsWith(`${fallbackBase}/`)) {
    const path = url.slice(fallbackBase.length + 1).split(/[?#]/)[0]
    let key = path
    try {
      key = decodeURIComponent(path)
    } catch {
      // kept as written
    }
    return { url: asUrl(fallbackBase, key), fallback: undefined }
  }
  const key = keyFromUrl(url, field)
  return { url: asUrl(publicBase(), key), fallback: fallbackBase ? asUrl(fallbackBase, key) : undefined }
}

// A URL the browser can PUT one file to. The content type and exact size are
// part of the signature, so an upload of anything else is rejected by R2.
export async function presignUpload(key: string, contentType: string, contentLength: number) {
  const { CLOUDFLARE_ACCOUNT_ID: account, R2_BUCKET_NAME: bucket, R2_ACCESS_KEY_ID: id, R2_SECRET_ACCESS_KEY: secret } = settings
  if (!account || !bucket || !id || !secret) {
    throw new ApiError(503, 'not_configured', 'R2 access keys are not set on the server')
  }
  const client = new AwsClient({ accessKeyId: id, secretAccessKey: secret, service: 's3', region: 'auto' })
  const url = new URL(`https://${account}.r2.cloudflarestorage.com/${bucket}/${encodeKey(key)}`)
  url.searchParams.set('X-Amz-Expires', String(UPLOAD_SECONDS))
  const signed = await client.sign(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, 'Content-Length': String(contentLength) },
    aws: { signQuery: true, allHeaders: true },
  })
  return signed.url
}
