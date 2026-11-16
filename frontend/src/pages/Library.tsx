import { Download, Eye, Globe, ImageOff, Play, X } from 'lucide-react'
import { Dialog } from 'radix-ui'
import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import { Pager } from '../components/DataTable'
import { button, Select } from '../components/ui'
import { SearchAndRefresh, useDebounced, useServerList } from '../components/videos/ServerTable'
import { useWorkspace } from '../data'
import { api, ApiError, text, type ApiRecord } from '../lib/api'

const ALL = 'all'
const PAGE_SIZE = 60
const PHASES = ['problem', 'failed_alternative', 'turn', 'solution', 'proof', 'cta', 'neutral']
const KINDS = ['clip', 'still', 'photo', 'ad_static', 'gfx', 'presenter']
const YES_NO = [
  { value: ALL, label: 'Any' },
  { value: '1', label: 'Yes' },
  { value: '0', label: 'No' },
]
const YES_NO_TAG = [
  { value: ALL, label: 'Any' },
  { value: 'true', label: 'Yes' },
  { value: 'false', label: 'No' },
]
const GRID_FIELDS = ['Asset Key', 'Subject', 'Kind', 'Phase', 'Product', 'Generic', 'Product Visible', 'Duration Ms', 'thumbnailUrl', 'tags']
const VIDEO_FILE = /\.(mp4|mov|webm|m4v)$/i
const SHARED_TAG = 'shared_products'

const label = (value: string) => value.replace(/_/g, ' ')
const withAll = (values: string[], noun: string) => [{ value: ALL, label: `Every ${noun}` }, ...values.map((value) => ({ value, label: label(value) }))]

function duration(ms: unknown) {
  if (typeof ms !== 'number' || ms <= 0) return ''
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const link = (record: ApiRecord | undefined, field: string) => {
  const value = record?.fields[field]
  return typeof value === 'string' && value ? value : null
}

const isShared = (record: ApiRecord | undefined) => {
  const tags = record?.fields.tags as Record<string, unknown> | undefined
  const value = tags?.[SHARED_TAG]
  return Array.isArray(value) ? value.length > 0 : Boolean(value)
}

function SharedMark({ className = '' }: { className?: string }) {
  return (
    <span title="No voice: shown for every language version" className={`inline-flex items-center gap-1 rounded bg-white/90 px-1.5 py-0.5 text-xs font-medium text-neutral-800 shadow-sm ${className}`}>
      <Globe className="size-3" aria-hidden />
      All languages
    </span>
  )
}

function fileNameFrom(header: string | null) {
  const match = /filename="([^"]+)"/.exec(header ?? '')
  return match ? match[1] : 'asset'
}

function DownloadButton({ id }: { id: string }) {
  const { expire } = useAuth()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string>()

  async function save() {
    setBusy(true)
    setFailed(undefined)
    try {
      const res = await fetch(`/api/v1/library/assets/${id}/download`)
      if (res.status === 401) {
        expire()
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error?.message ?? `Download failed (${res.status})`)
      }
      const name = fileNameFrom(res.headers.get('Content-Disposition'))
      const url = URL.createObjectURL(await res.blob())
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = name
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (err) {
      setFailed(err instanceof Error ? err.message : 'Download failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" onClick={() => void save()} disabled={busy} title={failed} className={button.secondary}>
      <Download className="size-4" aria-hidden />
      {busy ? 'Downloading…' : failed ? 'Try again' : 'Download'}
    </button>
  )
}

const isVideo = (record: ApiRecord) => typeof record.fields['Duration Ms'] === 'number' || VIDEO_FILE.test(link(record, 'fileUrl') ?? '')

interface Page {
  records: ApiRecord[]
  total: number
}

interface TagType {
  key: string
  label: string
  kind: string
  values: string[]
  filter: boolean
}

type TagValue = string | number | boolean

function tagTypesFrom(records: ApiRecord[] | undefined): TagType[] {
  return (records ?? []).map((record) => ({
    key: text(record, 'Key'),
    label: text(record, 'Label') || text(record, 'Key'),
    kind: text(record, 'Kind'),
    values: Array.isArray(record.fields.Values) ? (record.fields.Values as string[]) : [],
    filter: Boolean(record.fields.Filter),
  }))
}

function tagOptions(type: TagType) {
  if (type.kind === 'flag') return YES_NO_TAG
  return [{ value: ALL, label: 'Any' }, ...type.values.map((value) => ({ value, label: label(value) }))]
}

function tagText(type: TagType | undefined, value: TagValue | TagValue[]): string {
  if (Array.isArray(value)) return value.map((item) => tagText(type, item)).join(', ')
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  return type?.kind === 'choice' ? label(String(value)) : String(value)
}

function tagRows(record: ApiRecord | undefined, types: TagType[]) {
  const tags = record?.fields.tags
  if (!tags || typeof tags !== 'object') return []
  const byKey = new Map(types.map((type, index) => [type.key, { type, index }]))
  return Object.entries(tags as Record<string, TagValue | TagValue[]>)
    .map(([key, value]) => {
      const known = byKey.get(key)
      return { key, name: known?.type.label ?? label(key), value: tagText(known?.type, value), order: known?.index ?? types.length }
    })
    .filter((row) => row.value !== '')
    .sort((a, b) => a.order - b.order || a.key.localeCompare(b.key))
}

function Filter({ name, value, options, onChange }: { name: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-neutral-600">
      {name}
      <Select label={name} value={value} options={options} onValueChange={onChange} className="min-w-28" />
    </label>
  )
}

function Placeholder({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center bg-neutral-100 text-neutral-400 ${className}`}>
      <ImageOff className="size-6" aria-hidden />
      <span className="sr-only">No preview yet</span>
    </div>
  )
}

function Tile({ record, product, onOpen }: { record: ApiRecord; product: string; onOpen: () => void }) {
  const thumb = link(record, 'thumbnailUrl')
  const video = isVideo(record)
  const length = duration(record.fields['Duration Ms'])
  const title = text(record, 'Subject') || text(record, 'Asset Key')
  return (
    <button
      type="button"
      onClick={onOpen}
      title={title}
      className="group overflow-hidden rounded-lg border border-neutral-200 bg-white text-left hover:border-neutral-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
    >
      <div className="relative aspect-square bg-neutral-100">
        {thumb ? (
          <img src={thumb} alt={title} loading="lazy" decoding="async" width={400} height={400} className="absolute inset-0 size-full object-contain" />
        ) : (
          <Placeholder className="absolute inset-0" />
        )}
        {video && (
          <span className="absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white tabular-nums dark:text-[#fff]">
            <Play className="size-3" aria-hidden />
            {length}
          </span>
        )}
        {isShared(record) && <SharedMark className="absolute top-1.5 left-1.5" />}
        {record.fields['Product Visible'] ? (
          <span title="Product in frame" className="absolute top-1.5 right-1.5 inline-flex items-center rounded bg-white/90 p-1 text-neutral-800 shadow-sm">
            <Eye className="size-3.5" aria-hidden />
            <span className="sr-only">Product in frame</span>
          </span>
        ) : null}
      </div>
      <div className="space-y-0.5 px-2.5 py-2 text-xs">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium text-neutral-900 capitalize">{label(text(record, 'Kind'))}</span>
          <span className="truncate text-neutral-600">{label(text(record, 'Phase'))}</span>
        </div>
        <div className="truncate text-neutral-500">{product}</div>
      </div>
    </button>
  )
}

function Preview({ record, product, types, onClose }: { record: ApiRecord | null; product: (record: ApiRecord) => string; types: TagType[]; onClose: () => void }) {
  const { expire } = useAuth()
  const [loaded, setLoaded] = useState<ApiRecord>()
  const [error, setError] = useState<string>()
  const id = record?.id

  useEffect(() => {
    if (!id) return
    let stale = false
    setLoaded(undefined)
    setError(undefined)
    api<ApiRecord>(`/data/media_assets/${id}`)
      .then((res) => !stale && setLoaded(res))
      .catch((err: Error) => {
        if (stale) return
        if (err instanceof ApiError && err.status === 401) expire()
        else setError(err.message)
      })
    return () => {
      stale = true
    }
  }, [id, expire])

  const shown = loaded ?? record ?? undefined
  const file = link(loaded, 'fileUrl')
  const thumb = link(shown, 'thumbnailUrl')
  const video = shown ? isVideo(shown) : false
  const width = shown?.fields.Width
  const height = shown?.fields.Height
  const tags = shown
    ? [
        ['Kind', label(text(shown, 'Kind'))],
        ['Phase', label(text(shown, 'Phase'))],
        ['Product', product(shown)],
        ['Product in frame', shown.fields['Product Visible'] ? 'Yes' : 'No'],
        ['Subject', text(shown, 'Subject')],
        ['Orientation', text(shown, 'Orientation')],
        ['Aspect', text(shown, 'Aspect')],
        ['Size', typeof width === 'number' && typeof height === 'number' ? `${width} × ${height}` : ''],
        ['Duration', duration(shown.fields['Duration Ms'])],
        ['Rights', text(shown, 'Rights')],
        ['Approved', shown.fields.Approved ? 'Yes' : 'No'],
        ['Asset', text(shown, 'Asset Key')],
      ].filter(([, value]) => value)
    : []
  const extra = tagRows(shown, types)

  return (
    <Dialog.Root open={record !== null} onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex max-h-[90vh] w-[calc(100vw-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-white shadow-xl"
        >
          <div className="flex items-center justify-between gap-4 border-b border-neutral-200 px-6 py-4">
            <Dialog.Title className="truncate text-base font-semibold">{shown ? text(shown, 'Subject') || text(shown, 'Asset Key') : ''}</Dialog.Title>
            <div className="flex items-center gap-2">
              {file && loaded && <DownloadButton id={loaded.id} />}
              <Dialog.Close aria-label="Close" className={button.icon}>
                <X className="size-4" />
              </Dialog.Close>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <div className="flex items-center justify-center overflow-hidden rounded-md bg-neutral-900 dark:bg-black">
              {file && video ? (
                <video key={file} src={file} poster={thumb ?? undefined} controls preload="metadata" playsInline className="max-h-[60vh] w-full" />
              ) : file ? (
                <img src={file} alt={text(shown!, 'Subject') || 'Asset'} className="max-h-[60vh] w-auto max-w-full object-contain" />
              ) : thumb ? (
                <img src={thumb} alt={text(shown!, 'Subject') || 'Asset'} className="max-h-[60vh] w-auto max-w-full object-contain" />
              ) : (
                <Placeholder className="aspect-video w-full" />
              )}
            </div>
            {isShared(shown) && <SharedMark className="mt-3" />}
            {error && <p className="mt-3 text-sm text-red-700">Could not load this asset: {error}</p>}
            {!error && !loaded && <p className="mt-3 text-sm text-neutral-500">Loading…</p>}
            {loaded && !file && <p className="mt-3 text-sm text-neutral-500">No preview yet.</p>}
            <dl className="mt-4 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-2 text-sm">
              {tags.map(([name, value]) => (
                <div key={name} className="contents">
                  <dt className="text-neutral-500">{name}</dt>
                  <dd className="break-words">{value}</dd>
                </div>
              ))}
            </dl>
            {extra.length > 0 && (
              <>
                <h3 className="mt-5 text-sm font-semibold text-neutral-900">Tags</h3>
                <dl className="mt-2 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-2 text-sm">
                  {extra.map((row) => (
                    <div key={row.key} className="contents">
                      <dt className="text-neutral-500">{row.name}</dt>
                      <dd className="break-words">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export function Library() {
  const { products } = useWorkspace()
  const productName = new Map(products.map((product) => [product.id, product.name]))

  const [product, setProduct] = useState(ALL)
  const [phase, setPhase] = useState(ALL)
  const [kind, setKind] = useState(ALL)
  const [visible, setVisible] = useState(ALL)
  const [approved, setApproved] = useState(ALL)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<ApiRecord | null>(null)
  const [tagFilters, setTagFilters] = useState<Record<string, string>>({})
  const term = useDebounced(search.trim())
  const tagTypeList = useServerList<{ records: ApiRecord[] }>('/data/tag_types?sort=Position,Key&fields=Key,Label,Kind,Values,Filter')
  const tagTypes = tagTypesFrom(tagTypeList.data?.records)

  const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE), sort: 'Asset Key', fields: GRID_FIELDS.join(',') })
  if (product !== ALL) query.set('product', product)
  if (phase !== ALL) query.set('where[Phase]', phase)
  if (kind !== ALL) query.set('where[Kind]', kind)
  if (visible !== ALL) query.set('where[Product Visible]', visible)
  if (approved !== ALL) query.set('where[Approved]', approved)
  if (term) query.set('search', term)
  for (const type of tagTypes) {
    const value = tagFilters[type.key]
    if (type.filter && value && value !== ALL) query.append(`tag[${type.key}]`, value)
  }
  const { data, error, loading, reload } = useServerList<Page>(`/library/assets?${query}`)

  const lastPage = data ? Math.max(0, Math.ceil(data.total / PAGE_SIZE) - 1) : page
  useEffect(() => {
    if (page > lastPage) setPage(lastPage)
  }, [page, lastPage])

  function filterTag(key: string) {
    return (value: string) => {
      setTagFilters((current) => ({ ...current, [key]: value }))
      setPage(0)
    }
  }

  function filter(set: (value: string) => void) {
    return (value: string) => {
      set(value)
      setPage(0)
    }
  }

  const productOf = (record: ApiRecord) => {
    const id = (record.fields.Product as string[] | undefined)?.[0]
    if (id) return productName.get(id) ?? ''
    return record.fields.Generic ? 'Generic' : ''
  }

  const records = data?.records ?? []
  let empty = ''
  if (error) empty = `Could not load the library: ${error.message}`
  else if (!data) empty = 'Loading…'
  else if (!records.length) empty = 'No asset matches these filters.'

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
        <p className="mt-1 text-sm text-neutral-600">Footage and images that can be reused. Open one to view it or download it.</p>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Filter
          name="Product"
          value={product}
          options={[{ value: ALL, label: 'Every product' }, ...products.map((p) => ({ value: p.id, label: p.name }))]}
          onChange={filter(setProduct)}
        />
        <Filter name="Phase" value={phase} options={withAll(PHASES, 'phase')} onChange={filter(setPhase)} />
        <Filter name="Kind" value={kind} options={withAll(KINDS, 'kind')} onChange={filter(setKind)} />
        <Filter name="Product visible" value={visible} options={YES_NO} onChange={filter(setVisible)} />
        <Filter name="Approved" value={approved} options={YES_NO} onChange={filter(setApproved)} />
        {tagTypes
          .filter((type) => type.filter && (type.kind === 'flag' || type.values.length > 0))
          .map((type) => (
            <Filter key={type.key} name={type.label} value={tagFilters[type.key] ?? ALL} options={tagOptions(type)} onChange={filterTag(type.key)} />
          ))}
        <SearchAndRefresh noun="assets" value={search} onChange={filter(setSearch)} loading={loading} onRefresh={reload} />
      </div>

      <p className="mt-3 text-sm text-neutral-600" aria-live="polite">
        {data ? `${data.total.toLocaleString()} ${data.total === 1 ? 'asset' : 'assets'}` : ''}
      </p>

      {empty ? (
        <p className={`mt-2 rounded-lg border border-neutral-200 bg-white px-4 py-10 text-center text-sm ${error ? 'text-red-700' : 'text-neutral-500'}`}>{empty}</p>
      ) : (
        <div
          className={`mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 ${loading ? 'opacity-60' : ''}`}
          aria-busy={loading}
        >
          {records.map((record) => (
            <Tile key={record.id} record={record} product={productOf(record)} onOpen={() => setOpen(record)} />
          ))}
        </div>
      )}

      <Pager
        className="mt-3"
        noun="Assets"
        total={data?.total ?? 0}
        page={page}
        pageSize={PAGE_SIZE}
        pageSizes={[PAGE_SIZE]}
        onPage={setPage}
        onPageSize={() => setPage(0)}
      />

      <Preview record={open} product={productOf} types={tagTypes} onClose={() => setOpen(null)} />
    </>
  )
}
