import { ExternalLink } from 'lucide-react'
import { DataTable, type Column } from '../DataTable'
import { StatusBadge } from '../ui'
import { useRecords } from '../../data'
import { text, type ApiRecord } from '../../lib/api'
import { alertBox } from './shared'

interface VideoUsed {
  record: ApiRecord
  ai: boolean
}

const VIDEO_COLUMNS: Column<VideoUsed>[] = [
  { header: 'Video', cell: ({ record }) => text(record, 'Video Name') || 'Untitled' },
  { header: 'Type', cell: ({ ai }) => (ai ? 'AI video' : 'Video') },
  { header: 'Format', cell: ({ record }) => text(record, 'Format') || <span className="text-neutral-400">—</span> },
  { header: 'Status', cell: ({ record }) => <StatusBadge status={text(record, 'Status')} /> },
  {
    header: 'File',
    align: 'right',
    cell: ({ record }) =>
      text(record, 'Creative Link') ? (
        <a href={text(record, 'Creative Link')} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline">
          Open
          <ExternalLink className="size-3.5" />
        </a>
      ) : (
        <span className="text-neutral-400">—</span>
      ),
  },
]

// The videos and images linked to our campaign record: what the launch and every Add Ads since have put into it
export function MediaUsed({ campaignId }: { campaignId: string }) {
  const videos = useRecords('videos', { fields: 'Video Name,Format,Status,Creative Link', 'where[Used In Campaign]': campaignId })
  const aiVideos = useRecords('ai_videos', { fields: 'Video Name,Format,Status,Creative Link', 'where[Used In Campaign]': campaignId })
  const images = useRecords('images', { fields: 'Image Name,Image Drive Link', 'where[Used In Campaigns]': campaignId })

  const error = videos.error ?? aiVideos.error ?? images.error
  if (error) {
    return (
      <p role="alert" className={alertBox}>
        Could not load this campaign's media: {error}
      </p>
    )
  }

  const rows: VideoUsed[] = [
    ...(videos.records ?? []).map((record) => ({ record, ai: false })),
    ...(aiVideos.records ?? []).map((record) => ({ record, ai: true })),
  ].sort((a, b) => text(a.record, 'Video Name').localeCompare(text(b.record, 'Video Name')))
  const loaded = videos.records && aiVideos.records

  return (
    <div className="space-y-6">
      <section>
        <h2 className="text-sm font-semibold">Videos {loaded && <span className="font-normal text-neutral-500">({rows.length})</span>}</h2>
        <div className="mt-2">
          <DataTable columns={VIDEO_COLUMNS} rows={rows} rowKey={(row) => row.record.id} empty={loaded ? 'No videos are linked to this campaign.' : 'Loading…'} />
        </div>
      </section>
      <section>
        <h2 className="text-sm font-semibold">
          Images {images.records && <span className="font-normal text-neutral-500">({images.records.length})</span>}
        </h2>
        {images.records?.length ? (
          <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-3">
            {images.records.map((image) => {
              const url = text(image, 'Image Drive Link')
              const name = text(image, 'Image Name') || 'Untitled'
              return (
                <li key={image.id} className="overflow-hidden rounded-md border border-neutral-200 bg-white">
                  <a href={url || undefined} target="_blank" rel="noreferrer" className="block">
                    <span className="flex aspect-square items-center justify-center bg-neutral-100 text-xs text-neutral-400">
                      {url ? <img src={url} alt="" loading="lazy" className="size-full object-cover" /> : 'No preview'}
                    </span>
                    <span className="block truncate px-2 py-1.5 text-xs" title={name}>
                      {name}
                    </span>
                  </a>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="mt-2 rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">
            {images.records ? 'No images are linked to this campaign.' : 'Loading…'}
          </p>
        )}
      </section>
    </div>
  )
}
