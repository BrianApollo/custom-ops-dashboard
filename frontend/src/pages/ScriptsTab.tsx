import { ListPlus, Plus, UserPlus } from 'lucide-react'
import { Progress } from 'radix-ui'
import { useEffect, useState } from 'react'
import { useAuth } from '../auth'
import type { Column } from '../components/DataTable'
import { AddHooksDialog } from '../components/scripts/AddHooksDialog'
import { AddScriptDialog } from '../components/scripts/AddScriptDialog'
import { AssignDialog } from '../components/scripts/AssignDialog'
import { button, StatusBadge, StatusChips, Tip } from '../components/ui'
import { PAGE_SIZES, SearchAndRefresh, ServerTable, useDebounced, useEditors, useServerList } from '../components/videos/ServerTable'
import { statusLabel, VideoDetailDialog } from '../components/videos/VideoDetailDialog'
import { useWorkspace, type Product } from '../data'
import type { ApiRecord } from '../lib/api'

interface Props {
  product?: Product
  // with every product shown, each row says which product it belongs to
  productColumn: Column<ApiRecord>[]
}

// a row of GET /scripts
interface Script {
  id: string
  name: string | null
  productId: string | null
  productName: string | null
  assigned: boolean
  // share of the script's videos that are past To Do, 0 to 1; null when it has none
  progress: number | null
  editors: { id: string | null; name: string | null; videos: number }[]
  videos: { id: string; name: string | null; format: string | null; textVersion: string | null; status: string | null }[]
}

interface ScriptsPage {
  records: Script[]
  total: number
  counts: { all: number; assigned: number; unassigned: number }
}

const CHIPS = ['Assigned', 'Unassigned']

const nameOf = (script: Script) => script.name || 'Untitled'

// A script is assigned once videos have been made from it; its editors and progress come from those videos
export function ScriptsTab({ product, productColumn }: Props) {
  const { user } = useAuth()
  const { reload: reloadCounts } = useWorkspace()
  const isAdmin = user?.role === 'admin'
  const { editors } = useEditors(isAdmin)

  // undefined until a chip is clicked; '' once the selected chip is clicked off
  const [picked, setPicked] = useState<string>()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(PAGE_SIZES[0])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [assigning, setAssigning] = useState<{ ids: string[]; label: string } | null>(null)
  const [adding, setAdding] = useState(false)
  const [hooksFor, setHooksFor] = useState<Script | null>(null)
  const [viewing, setViewing] = useState<string | null>(null)
  const [notice, setNotice] = useState<string>()

  const status = picked ?? 'Assigned'
  const term = useDebounced(search.trim())

  const query = new URLSearchParams({ limit: String(pageSize), offset: String(page * pageSize) })
  if (status) query.set('assigned', String(status === 'Assigned'))
  if (product) query.set('productId', product.id)
  if (term) query.set('search', term)
  const { data, error, loading, reload } = useServerList<ScriptsPage>(`/scripts?${query}`)

  // the list can shrink under the current page, e.g. when the last unassigned scripts are assigned
  const lastPage = data ? Math.max(0, Math.ceil(data.total / pageSize) - 1) : page
  useEffect(() => {
    if (page > lastPage) setPage(lastPage)
  }, [page, lastPage])

  // the selection belongs to the list it was made in: a new product starts with none
  useEffect(() => setSelected(new Set()), [product?.id])

  // a new filter starts again from page one, with nothing selected
  function filter(change: () => void) {
    change()
    setPage(0)
    setSelected(new Set())
  }

  function refresh() {
    reload()
    // the Unassigned count in the page header
    void reloadCounts()
  }

  let empty: string
  if (error) empty = `Could not load scripts: ${error.message}`
  else if (!data) empty = 'Loading…'
  else if (term || status) empty = 'No script matches the search and status filter.'
  else empty = `No scripts ${product ? `for ${product.name} ` : ''}yet.`

  const columns: Column<Script>[] = [
    { header: 'Script', cell: nameOf },
    // the server sends each row's product name, so the shared column (which reads a record's fields) is only a signal here
    ...(productColumn.length ? [{ header: 'Product', cell: (script: Script) => script.productName ?? '' }] : []),
    {
      header: 'Editors',
      cell: (script) =>
        script.editors.length === 0 ? (
          <span className="text-neutral-400">—</span>
        ) : (
          <span className="flex flex-wrap gap-1">
            {script.editors.map((editor) => (
              <span
                key={editor.id ?? 'none'}
                className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-800 ring-1 ring-amber-600/20 ring-inset"
              >
                {editor.name ?? 'No editor'} ({editor.videos})
              </span>
            ))}
          </span>
        ),
    },
    { header: 'Status', cell: (script) => <StatusBadge status={script.assigned ? 'Assigned' : 'Unassigned'} /> },
    {
      header: 'Progress',
      cell: (script) => {
        if (script.progress === null) return <span className="text-neutral-400">—</span>
        const percent = Math.round(script.progress * 100)
        return (
          <span className="flex items-center gap-2">
            <Progress.Root value={percent} aria-label="Videos past To Do" className="h-1.5 w-20 overflow-hidden rounded-full bg-neutral-200">
              <Progress.Indicator className="h-full rounded-full bg-emerald-600" style={{ width: `${percent}%` }} />
            </Progress.Root>
            <span className="text-xs text-neutral-600 tabular-nums">{percent}%</span>
          </span>
        )
      },
    },
  ]
  if (isAdmin) {
    columns.push({
      header: 'Actions',
      align: 'right',
      cell: (script) => (
        // one line, so every row is the same height
        <span className="-my-1 inline-flex items-center justify-end gap-1 whitespace-nowrap">
          <Tip label="Add hooks">
            <button aria-label="Add hooks" onClick={() => setHooksFor(script)} className={button.icon}>
              <ListPlus className="size-4" />
            </button>
          </Tip>
          {/* a script that already has videos needs no Assign; more editors can still be added by ticking it */}
          {!script.assigned && (
            <button onClick={() => setAssigning({ ids: [script.id], label: nameOf(script) })} className={button.secondary}>
              Assign
            </button>
          )}
        </span>
      ),
    })
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <StatusChips
          chips={CHIPS}
          counts={new Map([
            ['Assigned', data?.counts.assigned ?? 0],
            ['Unassigned', data?.counts.unassigned ?? 0],
          ])}
          value={status}
          onValueChange={(value) => filter(() => setPicked(value))}
        />
        <p className="text-sm text-neutral-600" aria-live="polite">
          {selected.size > 0 ? (
            <>
              {selected.size.toLocaleString()} selected ·{' '}
              <button onClick={() => setSelected(new Set())} className="text-blue-700 hover:underline">
                Clear
              </button>
            </>
          ) : data ? (
            `${data.total.toLocaleString()} ${data.total === 1 ? 'script' : 'scripts'}`
          ) : (
            ''
          )}
        </p>
        {selected.size > 0 && (
          <button
            onClick={() =>
              setAssigning({ ids: [...selected], label: `${selected.size.toLocaleString()} ${selected.size === 1 ? 'script' : 'scripts'}` })
            }
            className={button.secondary}
          >
            <UserPlus className="size-4" />
            Assign to editors
          </button>
        )}

        <SearchAndRefresh noun="scripts" value={search} onChange={(value) => filter(() => setSearch(value))} loading={loading} onRefresh={refresh} />

        {isAdmin && (
          <Tip label={product ? 'Add a script to this product' : 'Select a product first'}>
            {/* a disabled button fires no pointer events, so the span carries the tooltip */}
            <span tabIndex={product ? undefined : 0}>
              <button disabled={!product} onClick={() => setAdding(true)} className={button.primary}>
                <Plus className="size-4" />
                Add Script
              </button>
            </span>
          </Tip>
        )}
      </div>

      {notice && (
        <p role="status" className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-sm text-blue-900">
          {notice}
        </p>
      )}

      <div className="mt-3">
        <ServerTable
          columns={columns}
          rows={data?.records ?? []}
          rowKey={(script) => script.id}
          empty={empty}
          emptyIsError={Boolean(error)}
          loading={loading}
          // only admins can do anything with a selection
          selected={isAdmin ? selected : undefined}
          onSelectedChange={isAdmin ? setSelected : undefined}
          expand={(script) =>
            script.videos.length === 0 ? (
              <p className="pl-10 text-sm text-neutral-500">No videos have been made from this script yet.</p>
            ) : (
              <ul className="space-y-2 pl-10">
                {script.videos.map((video) => (
                  <li key={video.id} className="flex items-center gap-4 text-sm">
                    <button onClick={() => setViewing(video.id)} className="min-w-0 flex-1 truncate text-left text-blue-700 hover:underline">
                      {video.name || 'Untitled'}
                    </button>
                    <span className="text-xs text-neutral-600">{[video.format, video.textVersion].filter(Boolean).join(' · ')}</span>
                    <StatusBadge status={statusLabel(video.status ?? '')} />
                  </li>
                ))}
              </ul>
            )
          }
          total={data?.total ?? 0}
          page={page}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={(size) => {
            setPageSize(size)
            setPage(0)
          }}
        />
      </div>

      {assigning && (
        <AssignDialog
          scriptIds={assigning.ids}
          label={assigning.label}
          editors={editors.filter((editor) => editor.active)}
          onClose={() => setAssigning(null)}
          onAssigned={() => {
            setSelected(new Set())
            refresh()
          }}
        />
      )}

      {adding && product && (
        <AddScriptDialog
          product={product}
          onClose={() => setAdding(false)}
          onCreated={(names) => {
            setAdding(false)
            setNotice(names.length === 1 ? `Created ${names[0]}.` : `Created ${names.length} scripts, ${names[0]} and its hooks.`)
            // a new script has no videos, so it is shown where it can be found
            filter(() => setPicked('Unassigned'))
            refresh()
          }}
        />
      )}

      {hooksFor && (
        <AddHooksDialog
          script={{ id: hooksFor.id, name: nameOf(hooksFor), productId: hooksFor.productId }}
          onClose={() => setHooksFor(null)}
          onAdded={(created) => {
            setHooksFor(null)
            setNotice(created ? `Added ${created} ${created === 1 ? 'hook' : 'hooks'} to ${nameOf(hooksFor)}.` : `Split ${nameOf(hooksFor)} into its hook and body.`)
            if (created) filter(() => setPicked('Unassigned'))
            refresh()
          }}
        />
      )}

      {viewing && <VideoDetailDialog videoId={viewing} kind="video" onClose={() => setViewing(null)} onChanged={refresh} />}
    </>
  )
}
