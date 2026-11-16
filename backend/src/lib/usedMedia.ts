// Which media are marked Used when they go into an ad, and the campaign link
// field each kind is added to. Images are linked but never marked Used.

// request key -> the campaign link field it adds to
export const MEDIA_FIELDS = {
  videoIds: 'Videos Used In This Campaign',
  aiVideoIds: 'Videos copy',
  imageIds: 'Images Used In This Campaign',
} as const

export type MediaKey = keyof typeof MEDIA_FIELDS

export const marksUsed = (key: string) => key === 'videoIds' || key === 'aiVideoIds'

// the table a dashboard video lives in -> its request key
const KEY_BY_TABLE = { videos: 'videoIds', ai_videos: 'aiVideoIds' } as const

export type VideoTable = keyof typeof KEY_BY_TABLE

export const isVideoTable = (table: unknown): table is VideoTable => table === 'videos' || table === 'ai_videos'

export const mediaKeyFor = (table: VideoTable): MediaKey => KEY_BY_TABLE[table]

// the campaign link field a video of this table is added to
export const linkFieldFor = (table: VideoTable) => MEDIA_FIELDS[mediaKeyFor(table)]

export interface MarkedUsed {
  videos: string[]
  aiVideos: string[]
}

// ids read back as Used, by request key -> the response shape
export const markedUsedFrom = (byKey: Partial<Record<MediaKey, string[]>>): MarkedUsed => ({
  videos: byKey.videoIds ?? [],
  aiVideos: byKey.aiVideoIds ?? [],
})
