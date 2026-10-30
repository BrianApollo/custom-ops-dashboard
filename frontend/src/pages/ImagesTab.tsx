import { Check, ChevronLeft, ChevronRight, ImageOff, Plus, RefreshCw, Search, Trash2, WandSparkles, X } from 'lucide-react'
import { AlertDialog, Checkbox, Dialog } from 'radix-ui'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth'
import { CreateImagesDialog } from '../components/CreateImagesDialog'
import { checkbox, Pager } from '../components/DataTable'
import { button, StatusBadge, StatusChips, Tip } from '../components/ui'
import { useRecords, useWorkspace, type Product } from '../data'
import { api, text, type ApiRecord } from '../lib/api'
import { matchesSearch } from '../lib/search'

const STATUSES = ['New', 'Available', 'Used']
const PAGE_SIZES = [24, 48, 96]
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
}

interface Item {
  id: string
  name: string
  url: string
  // New: generated and waiting for approval. Used: in at least one campaign.
  status: string
  angles: string
  productId?: string
  created: string
}

// GET /image-generation/{jobId}; the shape is provisional on the server's side
interface JobState {
  status: string
  output: { saved: number; failed: { image: number; error: string }[] } | null
  error: { name: string; message: string } | null
}

interface Generation {
  jobId: string
  count: number
  productName: string
  state?: JobState
  // finished one way or another; it is no longer asked about
  over: boolean
}

const STILL_RUNNING = ['queued', 'running', 'waiting', 'paused']
const POLL_MS = 10_000

// One generation job: working, then what it made, or why it stopped
function GenerationNotice({ generation, onDismiss }: { generation: Generation; onDismiss: () => void }) {
  const { state, count, productName } = generation
  const status = state?.status
  const images = `${count} ${count === 1 ? 'image' : 'images'}`
  let tone = 'bg-blue-50 text-blue-900'
  let title = `Generating ${images} for ${productName}…`
  let detail = 'They appear under New one by one as each is ready.'
  if (status === 'complete') {
    const failed = state?.output?.failed ?? []
    tone = failed.length ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-900'
    title = `${productName}: ${state?.output?.saved ?? 0} saved${failed.length ? `, ${failed.length} failed` : ''}.`
    detail = failed.map((failure) => `Image ${failure.image}: ${failure.error}`).join(' · ')
  } else if (status === 'errored') {
    tone = 'bg-red-50 text-red-800'
    title = `Generating ${images} for ${productName} failed.`
    detail = state?.error?.message ?? ''
  } else if (status === 'terminated') {
    tone = 'bg-red-50 text-red-800'
    title = `Generating ${images} for ${productName} was stopped.`
    detail = 'Images finished before it stopped are under New.'
  } else if (generation.over) {
    tone = 'bg-amber-50 text-amber-900'
    title = `Lost track of generating ${images} for ${productName}.`
    detail = state?.error?.message ?? 'The server no longer reports on this job. Images it finished are under New.'
  }
  return (
    <div role="status" className={`mt-3 flex items-start justify-between gap-3 rounded-md px-3 py-2 text-sm ${tone}`}>
      <div className="min-w-0">
        <p className="font-medium">{title}</p>
        {detail && <p className="mt-0.5 break-words">{detail}</p>}
      </div>
      {generation.over && (
        <button aria-label="Dismiss" onClick={onDismiss}>
          <X className="size-4" />
        </button>
      )}
    </div>
  )
}

const isUrl = (value: string) => /^https?:\/\//.test(value)

function Thumbnail({ item, className }: { item: Item; className: string }) {
  const [broken, setBroken] = useState(false)
  return isUrl(item.url) && !broken ? (
    <img src={item.url} alt={item.name} loading="lazy" decoding="async" onError={() => setBroken(true)} className={className} />
  ) : (
    <span className={`${className} flex items-center justify-center text-neutral-400`}>
      <ImageOff className="size-6" />
    </span>
  )
}

// Generated images served by Cloudflare Images are removed there too: https://imagedelivery.net/{account}/{id}/{variant}
const cloudflareId = (url: string) => (url.includes('imagedelivery.net/') ? new URL(url).pathname.split('/')[2] : null)

// A product's images as a gallery: review and approve generated ones, upload more, or start a generation job
export function ImagesTab({ product }: { product?: Product }) {
  const { user } = useAuth()
  const { products, reload: reloadCounts } = useWorkspace()
  const where: Record<string, string> = product ? { 'where[Product]': product.id } : {}
  const images = useRecords('images', { fields: 'Image Name,Product,Image Drive Link,Used In Campaigns,Angles,Count', ...where })
  const generated = useRecords('temp_images', { fields: 'Name,Product,Image Drive Link,Angles', ...where })
  const angles = useRecords('angles', { fields: 'Name', ...where })

  const [search, setSearch] = useState('')
  // undefined until a chip is clicked; '' once the selected chip is clicked off
  const [picked, setPicked] = useState<string>()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[1])
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirming, setConfirming] = useState<string[] | null>(null)
  // a running approve, delete or upload, and what the last one reported
  const [job, setJob] = useState<{ label: string; done: number; total: number } | null>(null)
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>()
  // image-generation jobs started from this page, newest first
  const [generations, setGenerations] = useState<Generation[]>([])
  const fileInput = useRef<HTMLInputElement>(null)

  const isAdmin = user?.role === 'admin'
  const angleNames = new Map((angles.records ?? []).map((angle) => [angle.id, text(angle, 'Name')]))
  const toItem = (record: ApiRecord, isNew: boolean): Item => ({
    id: record.id,
    name: text(record, isNew ? 'Name' : 'Image Name') || 'Untitled',
    url: text(record, 'Image Drive Link'),
    status: isNew ? 'New' : ((record.fields['Used In Campaigns'] as string[] | undefined) ?? []).length ? 'Used' : 'Available',
    angles: ((record.fields.Angles as string[] | undefined) ?? []).map((id) => angleNames.get(id) ?? '').filter(Boolean).join(', '),
    productId: (record.fields.Product as string[] | undefined)?.[0],
    created: record.createdTime,
  })

  const term = search.trim().toLowerCase()
  const searched = [
    ...(generated.records ?? []).map((record) => toItem(record, true)),
    ...(images.records ?? []).map((record) => toItem(record, false)),
  ].filter((item) => matchesSearch(term, item.name))

  const counts = new Map<string, number>()
  for (const item of searched) counts.set(item.status, (counts.get(item.status) ?? 0) + 1)
  const status = picked ?? 'Available'

  const items = searched
    .filter((item) => !status || item.status === status)
    // newest first
    .sort((a, b) => b.created.localeCompare(a.created))
  const pages = Math.max(1, Math.ceil(items.length / pageSize))
  const currentPage = Math.min(page, pages - 1)
  const visible = items.slice(currentPage * pageSize, (currentPage + 1) * pageSize)

  // only generated images can be approved or deleted here
  const selectable = isAdmin ? items.filter((item) => item.status === 'New') : []
  const chosen = selectable.filter((item) => selected.has(item.id))
  const previewIndex = items.findIndex((item) => item.id === previewId)
  const preview = items[previewIndex]

  const loading = images.loading || generated.loading
  const error = images.error ?? generated.error
  const loaded = images.records && generated.records

  function reload() {
    images.reload()
    generated.reload()
    angles.reload()
    void reloadCounts()
  }

  function toggle(id: string, on: boolean) {
    const next = new Set(selected)
    if (on) next.add(id)
    else next.delete(id)
    setSelected(next)
  }

  // Runs one request per item in turn and reports how many failed. The server
  // numbers images as it approves them, so these must not run side by side.
  async function run<T>(label: string, list: T[], step: (item: T) => Promise<unknown>, done: string) {
    setNotice(undefined)
    let failed = 0
    let lastError = ''
    for (const [i, item] of list.entries()) {
      setJob({ label, done: i, total: list.length })
      try {
        await step(item)
      } catch (err) {
        failed++
        lastError = (err as Error).message
      }
    }
    setJob(null)
    setNotice(
      failed
        ? { text: `${failed} of ${list.length} failed. Last error: ${lastError}`, error: true }
        : { text: `${list.length.toLocaleString()} ${done}.` },
    )
    setSelected(new Set())
    reload()
  }

  const approve = (list: Item[]) =>
    run('Approving', list, (item) => api(`/temp-images/${item.id}/approve`, { method: 'POST' }), 'approved and moved to Available')

  const remove = (list: Item[]) =>
    run(
      'Deleting',
      list,
      async (item) => {
        await api(`/data/temp_images/${item.id}`, { method: 'DELETE' })
        const hosted = cloudflareId(item.url)
        // the row is gone either way; a file left behind is not worth failing the delete for
        if (hosted) await api(`/cloudflare/images/${hosted}`, { method: 'DELETE' }).catch(() => undefined)
      },
      'deleted',
    )

  // The record is created first because the server gives it the product's next
  // number, and the file is stored under that number: {Product}_ImageAd_007.png
  async function upload(file: File, into: Product) {
    const extension = EXTENSIONS[file.type]
    if (!extension) throw new Error(`${file.name} is not a PNG, JPEG, WebP, GIF or AVIF image`)
    const record = await api<ApiRecord>('/images', { method: 'POST', body: { fields: { Product: [into.id] } } })
    try {
      const name = `${into.name}_ImageAd_${String(record.fields.Count ?? 0).padStart(3, '0')}`
      const target = await api<{ uploadUrl: string; publicUrl: string }>('/storage/presign', {
        method: 'POST',
        body: { kind: 'image', productId: into.id, fileName: `${name}.${extension}`, contentType: file.type, contentLength: file.size },
      })
      const put = await fetch(target.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
      if (!put.ok) throw new Error(`Storage refused ${file.name} (${put.status})`)
      await api(`/data/images/${record.id}`, {
        method: 'PATCH',
        body: { fields: { 'Image Name': name, 'Image Drive Link': target.publicUrl } },
      })
    } catch (err) {
      // no file, no image: an empty record would show up as a broken card
      await api(`/data/images/${record.id}`, { method: 'DELETE' }).catch(() => undefined)
      throw err
    }
  }

  const running = generations.filter((generation) => !generation.over)
  const pollKey = running.map((generation) => generation.jobId).join(',')
  useEffect(() => {
    if (!pollKey) return
    const timer = setInterval(async () => {
      const answers = await Promise.all(
        pollKey.split(',').map((jobId) =>
          api<JobState>(`/image-generation/${jobId}`)
            .then((state) => ({ jobId, state }))
            .catch((err: Error) => ({ jobId, state: { status: 'unknown', output: null, error: { name: 'Error', message: err.message } } as JobState })),
        ),
      )
      setGenerations((current) =>
        current.map((generation) => {
          const answer = answers.find((item) => item.jobId === generation.jobId)
          return answer ? { ...generation, state: answer.state, over: !STILL_RUNNING.includes(answer.state.status) } : generation
        }),
      )
      // finished images are added as New one by one, so the list is read again each time
      generated.reload()
      if (answers.some((answer) => !STILL_RUNNING.includes(answer.state.status))) void reloadCounts()
    }, POLL_MS)
    return () => clearInterval(timer)
    // the list object changes on every render; the job ids are what the timer depends on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollKey])

  const busy = job !== null
  const needsProduct = product ? null : 'Select a product first'
  // the server uses the product's logo as the reference picture, and refuses a product without one
  const needsLogo = product && !product.logo ? 'Add a Product Logo in the Setup tab first; it is the reference picture for generation' : null

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <StatusChips
          chips={STATUSES}
          counts={counts}
          value={status}
          onValueChange={(value) => {
            setPicked(value)
            setPage(0)
          }}
        />

        {selectable.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 border-l border-neutral-200 pl-3">
            <label className="flex items-center gap-2 text-sm text-neutral-700">
              <Checkbox.Root
                checked={chosen.length === 0 ? false : chosen.length === selectable.length ? true : 'indeterminate'}
                onCheckedChange={(on) => setSelected(on === true ? new Set(selectable.map((item) => item.id)) : new Set())}
                className={checkbox}
              >
                <Checkbox.Indicator>
                  <Check className="size-3" />
                </Checkbox.Indicator>
              </Checkbox.Root>
              {chosen.length ? `${chosen.length} of ${selectable.length} selected` : `Select all ${selectable.length}`}
            </label>
            <button disabled={busy || chosen.length === 0} onClick={() => approve(chosen)} className={button.primary}>
              <Check className="size-4" />
              Approve
            </button>
            <button disabled={busy || chosen.length === 0} onClick={() => setConfirming(chosen.map((item) => item.id))} className={button.secondary}>
              <Trash2 className="size-4" />
              Delete
            </button>
          </div>
        )}

        <div className="relative ml-auto w-full max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="search"
            aria-label="Search images"
            placeholder="Search images…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(0)
            }}
            className="block w-full rounded-md border border-neutral-300 bg-white py-1.5 pr-3 pl-8 text-sm outline-none placeholder:text-neutral-400 focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
          />
        </div>
        <Tip label="Refresh">
          <button onClick={reload} disabled={loading} aria-label="Refresh" className={button.icon}>
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </Tip>
        {isAdmin && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept={Object.keys(EXTENSIONS).join(',')}
              multiple
              hidden
              onChange={(e) => {
                const files = [...(e.target.files ?? [])]
                e.target.value = ''
                if (product && files.length) void run('Uploading', files, (file) => upload(file, product), 'uploaded to Available')
              }}
            />
            <Tip label={needsProduct ?? 'Upload image files for this product'}>
              {/* a disabled button fires no pointer events, so the span carries the tooltip */}
              <span tabIndex={product ? undefined : 0}>
                <button disabled={!product || busy} onClick={() => fileInput.current?.click()} className={button.primary}>
                  <Plus className="size-4" />
                  Add Images
                </button>
              </span>
            </Tip>
            <Tip label={needsProduct ?? needsLogo ?? 'Generate images for this product'}>
              <span tabIndex={product && !needsLogo ? undefined : 0}>
                <button disabled={!product || Boolean(needsLogo)} onClick={() => setCreating(true)} className={button.secondary}>
                  <WandSparkles className="size-4" />
                  Create
                </button>
              </span>
            </Tip>
          </>
        )}
      </div>

      {generations.map((generation) => (
        <GenerationNotice
          key={generation.jobId}
          generation={generation}
          onDismiss={() => setGenerations((current) => current.filter((item) => item.jobId !== generation.jobId))}
        />
      ))}

      {job && (
        <p role="status" className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {job.label} {job.done + 1} of {job.total}…
        </p>
      )}
      {notice && !job && (
        <p
          role="status"
          className={`mt-3 flex items-start justify-between gap-3 rounded-md px-3 py-2 text-sm ${notice.error ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-900'}`}
        >
          {notice.text}
          <button aria-label="Dismiss" onClick={() => setNotice(undefined)}>
            <X className="size-4" />
          </button>
        </p>
      )}

      {visible.length === 0 ? (
        <p
          className={`mt-3 rounded-lg border border-dashed border-neutral-300 px-4 py-14 text-center text-sm ${error ? 'text-red-700' : 'text-neutral-500'}`}
        >
          {error
            ? `Could not load images: ${error}`
            : !loaded
              ? 'Loading…'
              : term
                ? 'No image matches the search.'
                : status === 'New'
                  ? 'No generated images are waiting for approval.'
                  : `No ${status.toLowerCase()} images ${product ? `for ${product.name} ` : ''}yet.`}
        </p>
      ) : (
        <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3">
          {visible.map((item) => {
            const isSelected = selected.has(item.id)
            return (
              <li
                key={item.id}
                className={`relative rounded-lg border bg-white p-2 ${isSelected ? 'border-blue-700 ring-1 ring-blue-700' : 'border-neutral-200'}`}
              >
                <button
                  onClick={() => setPreviewId(item.id)}
                  aria-label={`Preview ${item.name}`}
                  className="block aspect-square w-full overflow-hidden rounded-md bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                >
                  <Thumbnail item={item} className="size-full object-cover" />
                </button>
                {isAdmin && item.status === 'New' && (
                  <Checkbox.Root
                    aria-label={`Select ${item.name}`}
                    checked={isSelected}
                    onCheckedChange={(on) => toggle(item.id, on === true)}
                    className={`${checkbox} absolute top-3.5 left-3.5 size-5 shadow-sm`}
                  >
                    <Checkbox.Indicator>
                      <Check className="size-3.5" />
                    </Checkbox.Indicator>
                  </Checkbox.Root>
                )}
                <p className="mt-2 truncate text-sm font-medium" title={item.name}>
                  {item.name}
                </p>
                <p className="truncate text-xs text-neutral-500">
                  {[product ? '' : products.find((p) => p.id === item.productId)?.name, item.angles].filter(Boolean).join(' · ') || ' '}
                </p>
              </li>
            )
          })}
        </ul>
      )}

      <Pager
        className="mt-4"
        noun="Images"
        total={items.length}
        page={currentPage}
        pageSize={pageSize}
        pageSizes={PAGE_SIZES}
        onPage={setPage}
        onPageSize={(size) => {
          setPageSize(size)
          setPage(0)
        }}
      />

      <Dialog.Root open={Boolean(preview)} onOpenChange={(open) => !open && setPreviewId(null)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60" />
          {preview && (
            <Dialog.Content
              aria-describedby={undefined}
              onKeyDown={(e) => {
                const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
                const next = items[previewIndex + step]
                if (step && next) setPreviewId(next.id)
              }}
              className="fixed top-1/2 left-1/2 z-50 flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-white shadow-xl"
            >
              <div className="flex items-center gap-3 border-b border-neutral-200 px-4 py-3">
                <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-semibold">{preview.name}</Dialog.Title>
                <StatusBadge status={preview.status} />
                <Dialog.Close aria-label="Close" className={button.icon}>
                  <X className="size-4" />
                </Dialog.Close>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center bg-neutral-100">
                <Thumbnail key={preview.id} item={preview} className="max-h-[68vh] min-h-40 max-w-full object-contain" />
              </div>
              <div className="flex flex-wrap items-center gap-2 border-t border-neutral-200 px-4 py-3">
                <button
                  aria-label="Previous image"
                  disabled={previewIndex === 0}
                  onClick={() => setPreviewId(items[previewIndex - 1].id)}
                  className={button.icon}
                >
                  <ChevronLeft className="size-4" />
                </button>
                <span className="text-sm text-neutral-600 tabular-nums">
                  {previewIndex + 1} of {items.length.toLocaleString()}
                </span>
                <button
                  aria-label="Next image"
                  disabled={previewIndex === items.length - 1}
                  onClick={() => setPreviewId(items[previewIndex + 1].id)}
                  className={button.icon}
                >
                  <ChevronRight className="size-4" />
                </button>
                <span className="min-w-0 flex-1 truncate text-sm text-neutral-500">{preview.angles}</span>
                {isAdmin && preview.status === 'New' && (
                  <>
                    <button disabled={busy} onClick={() => setConfirming([preview.id])} className={button.secondary}>
                      <Trash2 className="size-4" />
                      Delete
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        // move on to the next image, so a batch can be reviewed without closing
                        setPreviewId((items[previewIndex + 1] ?? items[previewIndex - 1])?.id ?? null)
                        void approve([preview])
                      }}
                      className={button.primary}
                    >
                      <Check className="size-4" />
                      Approve
                    </button>
                  </>
                )}
              </div>
            </Dialog.Content>
          )}
        </Dialog.Portal>
      </Dialog.Root>

      <AlertDialog.Root open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl">
            <AlertDialog.Title className="text-base font-semibold">
              Delete {confirming?.length === 1 ? 'this image' : `${confirming?.length} images`}?
            </AlertDialog.Title>
            <AlertDialog.Description className="mt-1 text-sm text-neutral-600">
              Generated images that are deleted cannot be brought back.
            </AlertDialog.Description>
            <div className="mt-5 flex justify-end gap-2">
              <AlertDialog.Cancel className={button.secondary}>Cancel</AlertDialog.Cancel>
              <AlertDialog.Action
                onClick={() => {
                  const ids = new Set(confirming)
                  if (previewId && ids.has(previewId)) setPreviewId(null)
                  void remove(items.filter((item) => ids.has(item.id)))
                }}
                className={`${button.primary} bg-red-700 hover:bg-red-800`}
              >
                Delete
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>

      {creating && product && (
        <CreateImagesDialog
          product={product}
          onClose={() => setCreating(false)}
          onStarted={(jobId, count) => {
            setCreating(false)
            setGenerations((current) => [{ jobId, count, productName: product.name, over: false }, ...current])
          }}
        />
      )}
    </>
  )
}
