import { RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAuth } from '../auth'
import { AddProfile } from '../components/profile-hub/AddProfile'
import { LIST_FIELDS } from '../components/profile-hub/model'
import { ProfileList } from '../components/profile-hub/ProfileList'
import { ProfilePane, type Draft } from '../components/profile-hub/ProfilePane'
import { button, Tip } from '../components/ui'
import { useRecords } from '../data'
import { api, ApiError, text, type ApiRecord } from '../lib/api'

const names = (records: ApiRecord[] | undefined, field: string) => new Map((records ?? []).map((record) => [record.id, text(record, field)]))

// Every Facebook profile: what it arrived with, what it uses now, and how far
// it is from live. The list on the left, one profile on the right.
function Hub() {
  const { expire } = useAuth()
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('profile') ?? ''
  const adding = params.get('add') === '1'

  const list = useRecords('profiles', { fields: LIST_FIELDS.join(',') })
  const bms = useRecords('business_managers', { fields: 'BM Name' })
  const pages = useRecords('pages', { fields: 'Page Name' })

  // full records, by id: loaded when a profile is opened and replaced by every save
  const [details, setDetails] = useState<Record<string, ApiRecord>>({})
  const [detailError, setDetailError] = useState<string>()
  const [version, setVersion] = useState(0)
  // unsaved edits per profile, kept while another profile is looked at
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})

  useEffect(() => {
    if (!selectedId) return
    let stale = false
    setDetailError(undefined)
    api<ApiRecord>(`/data/profiles/${selectedId}`)
      .then((record) => !stale && setDetails((current) => ({ ...current, [selectedId]: record })))
      .catch((err: Error) => {
        if (stale) return
        if (err instanceof ApiError && err.status === 401) expire()
        else setDetailError(err.message)
      })
    return () => {
      stale = true
    }
  }, [selectedId, version, expire])

  const unsaved = useMemo(() => new Set(Object.keys(drafts).filter((id) => Object.keys(drafts[id]).length > 0)), [drafts])

  // leaving the page would drop edits that only exist here
  useEffect(() => {
    if (unsaved.size === 0) return
    const warn = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsaved])

  // a save answers with the whole record, so the list's state follows without a reload
  const records = useMemo(() => (list.records ?? []).map((record) => details[record.id] ?? record), [list.records, details])
  const linkNames = useMemo(
    () => ({ 'Linked BM': names(bms.records, 'BM Name'), 'Linked Pages': names(pages.records, 'Page Name') }),
    [bms.records, pages.records],
  )

  const record = selectedId ? details[selectedId] : undefined
  const stored = (saved: ApiRecord) => setDetails((current) => ({ ...current, [saved.id]: saved }))

  function refresh() {
    setDetails({})
    setVersion((v) => v + 1)
    list.reload()
    bms.reload()
    pages.reload()
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Profile Hub</h1>
        <Tip label="Refresh">
          <button onClick={refresh} disabled={list.loading} aria-label="Refresh" className={button.icon}>
            <RefreshCw className={`size-4 ${list.loading ? 'animate-spin' : ''}`} />
          </button>
        </Tip>
      </div>

      {list.error ? (
        <p className="mt-6 text-sm text-red-700">Could not load profiles: {list.error}</p>
      ) : !list.records ? (
        <p className="mt-6 text-sm text-neutral-500">Loading…</p>
      ) : (
        <div className="mt-4 flex items-start gap-4">
          <div className="sticky top-6 h-[calc(100vh-7rem)]">
            <ProfileList
              records={records}
              value={adding ? '' : selectedId}
              onValueChange={(id) => setParams({ profile: id }, { replace: true })}
              onAdd={() => setParams({ add: '1' }, { replace: true })}
              unsaved={unsaved}
            />
          </div>

          {adding ? (
            <AddProfile
              onClose={() => setParams(selectedId ? { profile: selectedId } : {}, { replace: true })}
              onCreated={(id) => {
                list.reload()
                setParams({ profile: id }, { replace: true })
              }}
            />
          ) : !selectedId ? (
            <p className="flex-1 rounded-lg border border-dashed border-neutral-300 px-4 py-16 text-center text-sm text-neutral-500">Choose a profile, or add one with +.</p>
          ) : !record ? (
            <p className={`flex-1 text-sm ${detailError ? 'text-red-700' : 'text-neutral-500'}`}>{detailError ? `Could not load this profile: ${detailError}` : 'Loading…'}</p>
          ) : (
            <ProfilePane
              // per-profile UI state (name editing, received draft) does not carry over
              key={record.id}
              record={record}
              draft={drafts[record.id] ?? {}}
              onDraft={(update) => setDrafts((current) => ({ ...current, [record.id]: update(current[record.id] ?? {}) }))}
              onSaved={stored}
              linkNames={linkNames}
            />
          )}
        </div>
      )}
    </>
  )
}

// Passwords, 2FA secrets and recovery codes are only ever sent to admins
export function ProfileHub() {
  const { user } = useAuth()
  if (user?.role !== 'admin') {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Profile Hub</h1>
        <p className="mt-6 rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500">
          Profile Hub is for admins only.
        </p>
      </>
    )
  }
  return <Hub />
}
