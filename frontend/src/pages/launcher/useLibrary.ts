import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../../lib/api'

// Where a video stands in the ad account's library, as far as this page has seen
export interface LibraryEntry {
  state: 'ready' | 'processing' | 'missing' | 'uploading' | 'failed'
  fbVideoId?: string
  error?: string
}

interface Found {
  id: string
  title?: string
  status?: string
  picture: string | null
}

const UPLOAD_BATCH = 10
const POLL_MS = 5000
// ten minutes of asking; after that the Check button asks again
const MAX_POLLS = 120

// Checks which videos are already in the ad account's library and uploads the ones
// that are not, ahead of the launch. Videos are matched by name: a video's title on
// Facebook is its name here.
//
// A video is uploaded only after a check has just said it is missing, so pressing Upload
// can never put a second copy of a video that is already there. Upload makes that check
// itself, so a failed upload, or a newly ticked set, can simply be uploaded again.
export function useLibrary(cred: string, adAccountId: string) {
  const scope = `${cred}|${adAccountId}`
  const [store, setStore] = useState<{ scope: string; entries: Map<string, LibraryEntry> }>({ scope, entries: new Map() })
  const [busy, setBusy] = useState<'checking' | 'uploading'>()
  const [error, setError] = useState<string>()
  const [tick, setTick] = useState(0)
  const polls = useRef(0)
  const current = useRef(scope)
  current.current = scope

  // what was learnt about another ad account or token says nothing about this one
  const entries = store.scope === scope ? store.entries : new Map<string, LibraryEntry>()
  const ready = Boolean(cred) && /^(act_)?\d+$/.test(adAccountId)
  const base = `/facebook/ad-accounts/${encodeURIComponent(adAccountId)}/videos`

  function merge(changes: Map<string, LibraryEntry>) {
    setStore((before) => (scope !== current.current ? before : { scope, entries: new Map([...(before.scope === scope ? before.entries : []), ...changes]) }))
  }

  async function look(names: string[]) {
    const { results } = await api<{ results: Found[] }>(`${base}/check`, { method: 'POST', body: { cred, names } })
    return new Map(
      names.map((name): [string, LibraryEntry] => {
        const matches = results.filter((video) => video.title === name)
        const found = matches.find((video) => video.status === 'ready' && video.picture) ?? matches.find((video) => video.status === 'ready' || video.status === 'processing')
        if (!found) return [name, { state: 'missing' }]
        return [name, { state: found.status === 'ready' && found.picture ? 'ready' : 'processing', fbVideoId: found.id }]
      }),
    )
  }

  async function check(names: string[]) {
    if (!ready || busy || !names.length) return
    setBusy('checking')
    setError(undefined)
    try {
      merge(await look([...new Set(names)]))
      polls.current = 0
    } catch (err) {
      setError(`Could not read the ad account's library: ${(err as Error).message}`)
    }
    setBusy(undefined)
  }

  // Reads the library for these videos first, then sends only the ones it is missing.
  // Videos already there, or still processing there, are left alone.
  async function upload(videos: { name: string; url: string }[]) {
    if (!ready || busy || !videos.length) return
    setBusy('checking')
    setError(undefined)
    let found: Map<string, LibraryEntry>
    try {
      found = await look([...new Set(videos.map((video) => video.name))])
      merge(found)
    } catch (err) {
      setError(`Could not read the ad account's library, so nothing was uploaded: ${(err as Error).message}`)
      setBusy(undefined)
      return
    }
    const missing = videos.filter((video) => found.get(video.name)?.state === 'missing')
    if (missing.length) await send(missing)
    setBusy(undefined)
  }

  // `videos` must be known to be missing from the library at this moment
  async function send(videos: { name: string; url: string }[]) {
    setBusy('uploading')
    polls.current = 0
    for (let i = 0; i < videos.length; i += UPLOAD_BATCH) {
      const batch = videos.slice(i, i + UPLOAD_BATCH)
      merge(new Map(batch.map((video) => [video.name, { state: 'uploading' }])))
      try {
        const { results } = await api<{ results: { name: string; success: boolean; fbVideoId: string | null; error: string | null }[] }>(`${base}/upload`, {
          method: 'POST',
          body: { cred, videos: batch },
        })
        merge(
          new Map(
            batch.map((video, n): [string, LibraryEntry] => {
              const result = results[n]
              return result?.success && result.fbVideoId
                ? [video.name, { state: 'processing', fbVideoId: result.fbVideoId }]
                : [video.name, { state: 'failed', error: result?.error ?? 'Facebook returned no video id' }]
            }),
          ),
        )
      } catch (err) {
        const reason = (err as Error).message
        if (err instanceof ApiError && err.status < 500) {
          // refused before anything was sent to Facebook
          merge(new Map(batch.map((video) => [video.name, { state: 'failed', error: reason }])))
        } else {
          // the videos may have arrived all the same, so the library is read instead of sending them again
          try {
            merge(await look(batch.map((video) => video.name)))
          } catch {
            merge(new Map(batch.map((video) => [video.name, { state: 'failed', error: `${reason}. Check the library before uploading again.` }])))
          }
          setError(`An upload was not confirmed (${reason}). The library was read again to see what arrived.`)
        }
      }
    }
  }

  // videos Facebook is still processing are asked about every few seconds
  const processing = [...entries.values()].flatMap((entry) => (entry.state === 'processing' && entry.fbVideoId ? [entry.fbVideoId] : []))
  const key = processing.join()
  useEffect(() => {
    if (!key || polls.current >= MAX_POLLS) return
    const ids = key.split(',')
    const timer = window.setTimeout(async () => {
      polls.current++
      try {
        const { results } = await api<{ results: Found[] }>(`${base}/status`, { method: 'POST', body: { cred, videoIds: ids.slice(0, 50) } })
        const changes = new Map<string, LibraryEntry>()
        for (const [name, entry] of entries) {
          const video = results.find((candidate) => candidate.id === entry.fbVideoId)
          if (entry.state !== 'processing' || !video) continue
          if (video.status === 'ready' && video.picture) changes.set(name, { ...entry, state: 'ready' })
          else if (video.status === 'error') changes.set(name, { ...entry, state: 'failed', error: 'Facebook could not process this video' })
        }
        if (changes.size) merge(changes)
      } catch {
        // asked again on the next round
      }
      setTick((n) => n + 1)
    }, POLL_MS)
    return () => window.clearTimeout(timer)
    // `entries` is read as it is when the timer fires; the ids being waited on are in `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, tick, scope])

  return { entries, busy, error, ready, check, upload, processing: processing.length }
}
