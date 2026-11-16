import { invalid } from '../lib/errors'
import { RECORD_ID } from '../lib/ids'
import { isVideoTable, linkFieldFor, type VideoTable } from '../lib/usedMedia'

// A video is Used the moment an ad carrying it is created, paused included.
// These are the decisions behind marking the video of a replaced ad; the
// statements themselves are built in jobs.ts.

export interface VideoRecord {
  table: VideoTable
  id: string
}

// what the job result and GET /jobs/{id} report
export interface MarkedUsed {
  table: VideoTable
  id: string
  campaignRecordId: string | null
  status: string | null
}

// what the finishing step writes: the video to mark, and the campaign field to link it in
export interface MarkPlan extends VideoRecord {
  campaignRecordId: string | null
  linkField: string | null
}

// The dashboard record behind a file, from the rows whose creative_link matches it.
// Videos are looked at before AI videos; no match is null.
export function pickVideoRecord(matches: { table: string; id: unknown }[]): VideoRecord | null {
  for (const table of ['videos', 'ai_videos'] as const) {
    const found = matches.find((match) => match.table === table && typeof match.id === 'string' && match.id)
    if (found) return { table, id: found.id as string }
  }
  return null
}

// The optional campaignRecordId of a request: missing is undefined, anything
// that is not record-id shaped is refused
export function campaignRecordIdFrom(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !RECORD_ID.test(value)) throw invalid('campaignRecordId must be a record id', 'campaignRecordId')
  return value
}

// Which video to mark and where to link it. No video record means nothing is
// written; no campaign record means the video is marked Used but not linked.
export function markPlan(video: VideoRecord | null, campaignRecordId: string | null | undefined): MarkPlan | null {
  if (!video) return null
  const campaign = campaignRecordId || null
  return { ...video, campaignRecordId: campaign, linkField: campaign ? linkFieldFor(video.table) : null }
}

// `markedUsed` of a stored job result; null for results written before it existed
export function markedUsedOf(result: unknown): MarkedUsed | null {
  const value = (result as { markedUsed?: unknown } | null)?.markedUsed
  if (typeof value !== 'object' || value === null) return null
  const { table, id, campaignRecordId, status } = value as Record<string, unknown>
  if (!isVideoTable(table) || typeof id !== 'string') return null
  return {
    table,
    id,
    campaignRecordId: typeof campaignRecordId === 'string' ? campaignRecordId : null,
    status: typeof status === 'string' ? status : null,
  }
}
