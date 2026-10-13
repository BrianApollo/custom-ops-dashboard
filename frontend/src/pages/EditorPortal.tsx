import { useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { Pager } from '../components/DataTable'
import { MonthlyStats } from '../components/portal/MonthlyStats'
import { ScriptCard } from '../components/portal/ScriptCard'
import { groupByScript, statusOf, STATUSES, useEditorVideos, type PortalVideo } from '../components/portal/useEditorVideos'
import { useUploads } from '../components/portal/useUploads'
import { button, Select, StatusChips } from '../components/ui'
import { SearchAndRefresh, useEditors } from '../components/videos/ServerTable'
import { statusLabel, VideoDetailDialog } from '../components/videos/VideoDetailDialog'
import { useRecords } from '../data'
import { text } from '../lib/api'
import { UPLOAD_STATUSES } from '../lib/videoUpload'

const ALL_PRODUCTS = 'all'
// cards per page; the old grid showed 12
const PAGE_SIZES = [12, 24, 48]
// what an editor is expected to finish on a working day
const SCRIPTS_PER_DAY = 3
// with fewer scripts than this left, the editor is about to run out of work
const LOW_BACKLOG = 10

const plural = (count: number, noun: string) => `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`

// A video editor's whole app: the videos assigned to them, script by script. An admin picks an
// editor and sees the same page; from the grid they can only look, and a video's details give
// them what admins may do (review, notes, replacing the file).
export function EditorPortal() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  // roles arrive lower-cased
  const isEditor = user?.role === 'video editor'
  const { editors, error: editorsError, loaded } = useEditors(isAdmin)
  const [picked, setPicked] = useState('')

  if (!user || (!isAdmin && !isEditor)) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Videos</h1>
        <p className="mt-6 text-sm text-neutral-600">This page is for video editors.</p>
      </>
    )
  }

  // an editor never sees anyone's videos but their own, whatever is picked
  const editorId = isEditor ? user.id : picked

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{isEditor ? 'My videos' : 'Video editor portal'}</h1>
        {isAdmin && (
          <Select
            label="Editor"
            value={picked}
            placeholder={editorsError ? 'Could not load the editors' : loaded ? 'Choose an editor' : 'Loading…'}
            options={editors.map((editor) => ({ value: editor.id, label: editor.active ? editor.name : `${editor.name} (inactive)` }))}
            onValueChange={setPicked}
            className="w-56"
          />
        )}
      </div>
      {editorId ? (
        // a fresh page per editor: filters, uploads and the open video belong to one editor
        <Portal key={editorId} editorId={editorId} own={isEditor} />
      ) : (
        <p className="mt-6 rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500">
          {editorsError ? `Could not load the editors: ${editorsError}` : 'Choose an editor to see their videos.'}
        </p>
      )}
    </>
  )
}

function Portal({ editorId, own }: { editorId: string; own: boolean }) {
  const { videos, error, loading, reload } = useEditorVideos(editorId)
  // GET /videos gives a script's id; its name comes from here
  const scripts = useRecords('video_scripts', { fields: 'Name' })

  // the portal opens on what is left to do
  const [status, setStatus] = useState('To Do')
  const [product, setProduct] = useState(ALL_PRODUCTS)
  const [search, setSearch] = useState('')
  const [wantedPage, setWantedPage] = useState(0)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [viewing, setViewing] = useState<string | null>(null)
  // how many times a video changed here, which tells the monthly numbers to load again
  const [changes, setChanges] = useState(0)

  function changed() {
    reload()
    setChanges((n) => n + 1)
  }
  const uploads = useUploads(changed)

  const scriptNames = useMemo(() => new Map((scripts.records ?? []).map((script) => [script.id, text(script, 'Name')])), [scripts.records])
  const groups = useMemo(() => groupByScript(videos ?? [], scriptNames), [videos, scriptNames])

  const products = useMemo(() => {
    const names = new Map<string, string>()
    for (const group of groups) if (group.productId) names.set(group.productId, group.productName || 'Untitled')
    return [...names].map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label))
  }, [groups])

  // every word typed must appear in the script, its product or one of its videos
  const words = search.toLowerCase().split(/\s+/).filter(Boolean)
  const matching = groups.filter((group) => {
    if (product !== ALL_PRODUCTS && group.productId !== product) return false
    const haystack = [group.scriptName, group.productName, ...group.videos.map((video) => video.name ?? '')].join(' ').toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
  // the chips count videos; a script is listed under a status when any of its videos has it
  const counts = new Map(STATUSES.map((s) => [statusLabel(s), matching.reduce((n, group) => n + group.videos.filter((v) => statusOf(v) === s).length, 0)]))
  const shown = status ? matching.filter((group) => group.videos.some((video) => statusOf(video) === status)) : matching

  // the list can shrink under the current page, e.g. after the last To Do of a script is uploaded
  const page = Math.min(wantedPage, Math.max(0, Math.ceil(shown.length / pageSize) - 1))
  const visible = shown.slice(page * pageSize, (page + 1) * pageSize)

  // a new filter starts again from page one
  function filter(change: () => void) {
    change()
    setWantedPage(0)
  }

  const todo = (videos ?? []).filter((video) => statusOf(video) === 'To Do')
  const scriptsLeft = groups.filter((group) => group.videos.some((video) => statusOf(video) === 'To Do')).length
  const filtered = status !== '' || product !== ALL_PRODUCTS || words.length > 0

  // the server accepts an editor's changes only on their own videos; an admin works from the details
  const mayUpload = (video: PortalVideo) => own && UPLOAD_STATUSES.includes(statusOf(video))

  let empty: string | undefined
  if (error) empty = `Could not load the videos: ${error}`
  else if (!videos) empty = 'Loading…'
  else if (videos.length === 0) empty = own ? 'No videos are assigned to you yet.' : 'No videos are assigned to this editor.'
  else if (shown.length === 0) empty = 'No script matches the search and filters.'

  return (
    <>
      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-3">
          {!own && <p className="text-sm text-neutral-600">You are looking at this editor's portal. Open a video to review it, edit its notes or replace its file.</p>}
          {videos && (
            <p
              className={`inline-block rounded-md px-3 py-2 text-sm ring-1 ring-inset ${
                scriptsLeft < LOW_BACKLOG ? 'bg-red-50 text-red-800 ring-red-600/20' : 'bg-neutral-100 text-neutral-700 ring-neutral-500/20'
              }`}
            >
              {scriptsLeft < LOW_BACKLOG ? 'Only ' : ''}
              <strong className="font-semibold">{plural(scriptsLeft, 'script')}</strong> left to do · about{' '}
              {plural(Math.ceil(scriptsLeft / SCRIPTS_PER_DAY), 'working day')} · {plural(todo.length, 'video')}
            </p>
          )}
          <StatusChips chips={STATUSES.map(statusLabel)} counts={counts} value={statusLabel(status)} onValueChange={(label) => filter(() => setStatus(STATUSES.find((s) => statusLabel(s) === label) ?? ''))} />
        </div>
        <MonthlyStats editorId={editorId} version={changes} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Select
          label="Filter by product"
          value={product}
          options={[{ value: ALL_PRODUCTS, label: 'All products' }, ...products]}
          onValueChange={(value) => filter(() => setProduct(value))}
          className="w-48"
        />
        <p className="text-sm text-neutral-600" aria-live="polite">
          {videos ? plural(shown.length, 'script') : ''}
        </p>
        <SearchAndRefresh noun="scripts and videos" value={search} onChange={(value) => filter(() => setSearch(value))} loading={loading} onRefresh={changed} />
      </div>

      {own && videos && videos.length > 0 && (
        <p className="mt-2 text-xs text-neutral-500">
          Upload a file for a To Do video, or replace the file of one in review, with its button or by dropping the file on its cell. The video then goes to review.
        </p>
      )}

      {empty ? (
        <div className={`mt-3 rounded-lg border border-neutral-200 bg-white px-4 py-10 text-center text-sm ${error ? 'text-red-700' : 'text-neutral-500'}`}>
          <p>{empty}</p>
          {videos && videos.length > 0 && filtered && (
            <button
              onClick={() =>
                filter(() => {
                  setStatus('')
                  setProduct(ALL_PRODUCTS)
                  setSearch('')
                })
              }
              className={`${button.secondary} mt-3`}
            >
              Clear all filters
            </button>
          )}
        </div>
      ) : (
        <div className={`mt-3 grid gap-3 lg:grid-cols-2 ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
          {visible.map((group) => (
            <ScriptCard
              key={group.key}
              group={group}
              activeStatus={status}
              uploads={uploads.states}
              mayUpload={mayUpload}
              onOpen={(video) => setViewing(video.id)}
              onFile={(video, file) => void uploads.start(video.id, file)}
              onCancel={(video) => uploads.cancel(video.id)}
              onDismiss={(video) => uploads.dismiss(video.id)}
            />
          ))}
        </div>
      )}

      <Pager
        className="mt-3"
        noun="Scripts"
        total={shown.length}
        page={page}
        pageSize={pageSize}
        pageSizes={PAGE_SIZES}
        onPage={setWantedPage}
        onPageSize={(size) => filter(() => setPageSize(size))}
      />

      {viewing && <VideoDetailDialog videoId={viewing} kind="video" onClose={() => setViewing(null)} onChanged={changed} />}
    </>
  )
}
