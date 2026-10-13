import { Plus } from 'lucide-react'
import { ToggleGroup } from 'radix-ui'
import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import type { Column } from '../components/DataTable'
import { button, Select, StatusBadge, StatusChips, Tip } from '../components/ui'
import { CreateAiVideoDialog } from '../components/videos/CreateAiVideoDialog'
import { PAGE_SIZES, SearchAndRefresh, ServerTable, useDebounced, useEditors, useServerList } from '../components/videos/ServerTable'
import { statusLabel, VideoDetailDialog } from '../components/videos/VideoDetailDialog'
import { useWorkspace, type Product } from '../data'
import type { ApiRecord } from '../lib/api'

interface Props {
  product?: Product
  // with every product shown, each row says which product it belongs to
  productColumn: Column<ApiRecord>[]
}

// a row of GET /videos
interface Video {
  id: string
  name: string | null
  format: string | null
  textVersion: string | null
  status: string | null
  creativeLink: string | null
  createdTime: string
  editorName: string | null
  productName: string | null
}

interface VideosPage {
  records: Video[]
  total: number
  counts: { all: number; byStatus: Record<string, number> }
}

type Kind = 'script' | 'ai'

// the chips, in the order a video moves through them
const STATUSES = ['To Do', 'Review', 'Available', 'Used']
const ALL_EDITORS = 'all'

const pill = 'rounded px-1.5 py-0.5 text-[11px] font-medium'

export function VideosTab({ product, productColumn }: Props) {
  const { user } = useAuth()
  const { reload: reloadCounts } = useWorkspace()
  const isAdmin = user?.role === 'admin'
  const { editors } = useEditors(isAdmin)

  const [kind, setKind] = useState<Kind>('script')
  // undefined until a chip is clicked; '' once the selected chip is clicked off
  const [picked, setPicked] = useState<string>()
  const [pickedEditor, setPickedEditor] = useState<string>()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [viewing, setViewing] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // scripted videos open on what is ready to use; the short AI list opens unfiltered
  const status = picked ?? (kind === 'script' ? 'Available' : '')
  // an editor starts on their own videos and can widen the list to everyone's
  const editor = pickedEditor ?? (user?.role === 'video editor' ? user.id : ALL_EDITORS)
  const term = useDebounced(search.trim())

  const query = new URLSearchParams({ kind, limit: String(pageSize), offset: String(page * pageSize) })
  if (status) query.set('status', status)
  if (product) query.set('productId', product.id)
  if (editor !== ALL_EDITORS) query.set('editorId', editor)
  if (term) query.set('search', term)
  const { data, error, loading, reload } = useServerList<VideosPage>(`/videos?${query}`)

  // the list can shrink under the current page, e.g. after a video is accepted
  const lastPage = data ? Math.max(0, Math.ceil(data.total / pageSize) - 1) : page
  useEffect(() => {
    if (page > lastPage) setPage(lastPage)
  }, [page, lastPage])

  // a new filter starts again from page one
  function filter(change: () => void) {
    change()
    setPage(0)
  }

  function refresh() {
    reload()
    // the Available count in the page header
    void reloadCounts()
  }

  const noun = kind === 'ai' ? 'AI video' : 'video'
  let empty: string
  if (error) empty = `Could not load videos: ${error.message}`
  else if (!data) empty = 'Loading…'
  else if (term || status || editor !== ALL_EDITORS) empty = `No ${noun} matches the search and filters.`
  else empty = `No ${noun}s ${product ? `for ${product.name} ` : ''}yet.`

  const columns: Column<Video>[] = [
    {
      header: 'Video',
      cell: (video) => (
        <>
          {video.name || 'Untitled'}
          <span className="mt-1 flex gap-1 font-normal">
            {video.format && <span className={`${pill} bg-neutral-100 text-neutral-700`}>{video.format}</span>}
            {video.textVersion && (
              <span className={`${pill} ${video.textVersion === 'Text' ? 'bg-emerald-50 text-emerald-800' : 'bg-neutral-100 text-neutral-500'}`}>
                {video.textVersion}
              </span>
            )}
          </span>
        </>
      ),
    },
    // the server sends each row's product name, so the shared column (which reads a record's fields) is only a signal here
    ...(productColumn.length ? [{ header: 'Product', cell: (video: Video) => video.productName ?? '' }] : []),
    { header: 'Editor', cell: (video) => video.editorName ?? '' },
    { header: 'Status', cell: (video) => <StatusBadge status={statusLabel(video.status ?? '')} /> },
    { header: 'Created', cell: (video) => new Date(video.createdTime).toLocaleDateString() },
    {
      header: 'Creative',
      cell: (video) =>
        /^https?:\/\//.test(video.creativeLink ?? '') ? (
          <a href={video.creativeLink!} target="_blank" rel="noreferrer" className="text-blue-700 underline-offset-2 hover:underline">
            Open
          </a>
        ) : (
          (video.creativeLink ?? '')
        ),
    },
    {
      header: 'Actions',
      align: 'right',
      cell: (video) => (
        <button onClick={() => setViewing(video.id)} className={`${button.secondary} -my-1`}>
          View
        </button>
      ),
    },
  ]

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup.Root
          type="single"
          value={kind}
          // clicking the selected side again leaves it selected
          onValueChange={(value) =>
            value &&
            filter(() => {
              setKind(value as Kind)
              setPicked(undefined)
            })
          }
          aria-label="Kind of video"
          className="inline-flex rounded-md border border-neutral-300 bg-white p-0.5"
        >
          {[
            { value: 'script', label: 'Scripted' },
            { value: 'ai', label: 'AI' },
          ].map((option) => (
            <ToggleGroup.Item
              key={option.value}
              value={option.value}
              className="rounded px-2.5 py-1 text-sm font-medium text-neutral-600 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-blue-700 data-[state=on]:bg-blue-700 data-[state=on]:text-white"
            >
              {option.label}
            </ToggleGroup.Item>
          ))}
        </ToggleGroup.Root>

        <StatusChips
          chips={STATUSES.map(statusLabel)}
          counts={new Map(STATUSES.map((s) => [statusLabel(s), data?.counts.byStatus[s] ?? 0]))}
          value={statusLabel(status)}
          onValueChange={(label) => filter(() => setPicked(STATUSES.find((s) => statusLabel(s) === label) ?? ''))}
        />

        <Select
          label="Filter by editor"
          value={editor}
          options={[{ value: ALL_EDITORS, label: 'All editors' }, ...editors.map((e) => ({ value: e.id, label: e.name }))]}
          onValueChange={(value) => filter(() => setPickedEditor(value))}
          className="w-44"
        />

        <p className="text-sm text-neutral-600" aria-live="polite">
          {data ? `${data.total.toLocaleString()} ${data.total === 1 ? noun : `${noun}s`}` : ''}
        </p>

        <SearchAndRefresh
          noun={`${noun}s`}
          value={search}
          onChange={(value) => filter(() => setSearch(value))}
          loading={loading}
          onRefresh={refresh}
        />

        {isAdmin && kind === 'ai' && (
          <Tip label={product ? 'Upload a finished AI video for this product' : 'Select a product first'}>
            {/* a disabled button fires no pointer events, so the span carries the tooltip */}
            <span tabIndex={product ? undefined : 0}>
              <button disabled={!product} onClick={() => setCreating(true)} className={button.primary}>
                <Plus className="size-4" />
                Create AI Video
              </button>
            </span>
          </Tip>
        )}
      </div>

      <div className="mt-3">
        <ServerTable
          columns={columns}
          rows={data?.records ?? []}
          rowKey={(video) => video.id}
          empty={empty}
          emptyIsError={Boolean(error)}
          loading={loading}
          total={data?.total ?? 0}
          page={page}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(size) => filter(() => setPageSize(size))}
        />
      </div>

      {viewing && (
        <VideoDetailDialog
          videoId={viewing}
          kind={kind === 'ai' ? 'ai-video' : 'video'}
          onClose={() => setViewing(null)}
          onChanged={refresh}
        />
      )}

      {creating && product && (
        <CreateAiVideoDialog
          product={product}
          editors={editors.filter((e) => e.active)}
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            refresh()
          }}
        />
      )}
    </>
  )
}
