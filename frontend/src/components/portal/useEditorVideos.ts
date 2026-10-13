import { useEffect, useState } from 'react'
import { useAuth } from '../../auth'
import { api, ApiError } from '../../lib/api'

// a row of GET /videos
export interface PortalVideo {
  id: string
  name: string | null
  format: string | null
  textVersion: string | null
  status: string | null
  creativeLink: string | null
  productId: string | null
  productName: string | null
  scriptId: string | null
}

// One editor's videos for one script: a card of the production grid
export interface ScriptGroup {
  key: string
  scriptId: string | null
  scriptName: string
  productId: string | null
  productName: string
  videos: PortalVideo[]
}

// the columns and rows of a card, in the order the old grid drew them
export const FORMATS = ['Square', 'Vertical', 'YouTube']
export const TEXT_VERSIONS = ['Text', 'No Text']
// the order a video moves through them
export const STATUSES = ['To Do', 'Review', 'Available', 'Used']

const CHUNK = 1000

// a video with no status has not been started
export const statusOf = (video: PortalVideo) => video.status || 'To Do'

// what the names of a script's videos have in common, for a script whose own name is not known
function sharedName(videos: PortalVideo[]) {
  const names = videos.map((video) => video.name ?? '')
  let shared = names[0] ?? ''
  for (const name of names) {
    while (!name.startsWith(shared)) shared = shared.slice(0, -1)
  }
  return shared.replace(/[\s\-_]+$/, '')
}

// Every scripted video assigned to one editor. A card needs all the videos of its script, and
// GET /videos pages by video, so the whole list is read (in chunks) and grouped in the browser.
// While it loads again the previous answer stays on screen.
export function useEditorVideos(editorId: string | null) {
  const { expire } = useAuth()
  const [result, setResult] = useState<{ editorId: string | null; videos?: PortalVideo[]; error?: string }>({ editorId })
  const [loading, setLoading] = useState(false)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    if (!editorId) return
    let stale = false
    setLoading(true)
    async function load(editorId: string) {
      const videos: PortalVideo[] = []
      for (;;) {
        const query = new URLSearchParams({ kind: 'script', editorId, sort: 'name', limit: String(CHUNK), offset: String(videos.length) })
        const page = await api<{ records: PortalVideo[]; total: number }>(`/videos?${query}`)
        videos.push(...page.records)
        if (stale || page.records.length === 0 || videos.length >= page.total) break
      }
      if (!stale) setResult({ editorId, videos })
    }
    load(editorId)
      .catch((err: Error) => {
        if (stale) return
        if (err instanceof ApiError && err.status === 401) expire()
        else setResult({ editorId, error: err.message })
      })
      .finally(() => !stale && setLoading(false))
    return () => {
      stale = true
    }
  }, [editorId, version, expire])

  // an answer for another editor is not shown under this one
  const current = result.editorId === editorId ? result : undefined
  return { videos: current?.videos, error: current?.error, loading, reload: () => setVersion((v) => v + 1) }
}

// Cards by script name. `scriptNames` maps a script's id to its name.
export function groupByScript(videos: PortalVideo[], scriptNames: Map<string, string>): ScriptGroup[] {
  const groups = new Map<string, ScriptGroup>()
  for (const video of videos) {
    // videos without a script are kept together per product, so none is hidden
    const key = video.scriptId ?? `none:${video.productId ?? ''}`
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        scriptId: video.scriptId,
        scriptName: video.scriptId ? (scriptNames.get(video.scriptId) ?? '') : 'Videos without a script',
        productId: video.productId,
        productName: video.productName ?? '',
        videos: [],
      }
      groups.set(key, group)
    }
    group.videos.push(video)
  }
  for (const group of groups.values()) group.scriptName ||= sharedName(group.videos) || 'Untitled script'
  return [...groups.values()].sort((a, b) => a.scriptName.localeCompare(b.scriptName, undefined, { numeric: true }))
}
