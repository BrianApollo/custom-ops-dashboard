import { RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useAuth } from '../auth'
import { ProfilePicker, profileName, Progress } from '../components/profile-hub/ProfilePicker'
import { SetupBoxes, type Draft } from '../components/profile-hub/SetupBoxes'
import { boxesDone, isLive, LIST_FIELDS, TOTAL_BOXES } from '../components/profile-hub/sop'
import { VerifyDialog } from '../components/profile-hub/VerifyDialog'
import { button, StatusBadge, Tip } from '../components/ui'
import { useRecords } from '../data'
import { api, ApiError, text, type ApiRecord } from '../lib/api'

// the access sheet kept per person, shown read-only beside the setup boxes
const SUMMARY_FIELDS = ['Setup Status', 'Business Managers', 'Ad Accounts', 'Pages', 'Pixels', 'Team Access', 'To Do (you fill in)', 'Notes']

const names = (records: ApiRecord[] | undefined, field: string) => new Map((records ?? []).map((record) => [record.id, text(record, field)]))

function Hub() {
  const { expire } = useAuth()
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('profile') ?? ''

  const list = useRecords('profiles', { fields: LIST_FIELDS.join(','), sort: 'Profile Name' })
  const bms = useRecords('business_managers', { fields: 'BM Name' })
  const pages = useRecords('pages', { fields: 'Page Name' })
  const summaries = useRecords('profile_setup_summary', {})

  // full records, by id: loaded when a profile is opened and replaced by every save
  const [details, setDetails] = useState<Record<string, ApiRecord>>({})
  const [detailError, setDetailError] = useState<string>()
  const [version, setVersion] = useState(0)
  // unsaved edits per profile, kept while another profile is looked at
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [verifying, setVerifying] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [actionError, setActionError] = useState<string>()

  useEffect(() => {
    if (!selectedId) return
    let stale = false
    setDetailError(undefined)
    setActionError(undefined)
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

  // a save answers with the whole record, so the picker's progress follows without a reload
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
    summaries.reload()
  }

  async function reopen(id: string) {
    setReopening(true)
    setActionError(undefined)
    try {
      stored(await api<ApiRecord>(`/data/profiles/${id}`, { method: 'PATCH', body: { fields: { 'Setup Complete': false, 'Setup Completed On': '' } } }))
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) expire()
      else setActionError((err as Error).message)
    } finally {
      setReopening(false)
    }
  }

  const summary = record && summaries.records?.find((row) => {
    const uid = text(row, 'Profile UID')
    const person = text(row, 'Person').toLowerCase()
    return (
      (uid !== '' && [text(record, 'UID'), text(record, 'Profile FB UID'), text(record, 'Profile ID')].includes(uid)) ||
      (person !== '' && person === text(record, 'Profile Name').toLowerCase())
    )
  })

  const done = record ? boxesDone(record) : 0
  const blocked = !record
    ? ''
    : unsaved.has(record.id)
      ? 'Save or discard the unsaved changes first.'
      : done < TOTAL_BOXES
        ? `${TOTAL_BOXES - done} of ${TOTAL_BOXES} boxes are not complete yet.`
        : ''

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Profile Hub</h1>
          <p className="mt-1 text-sm text-neutral-600">Take a Facebook profile through setup, one box at a time, until it is live.</p>
        </div>
        <Tip label="Refresh">
          <button onClick={refresh} disabled={list.loading} aria-label="Refresh" className={button.icon}>
            <RefreshCw className={`size-4 ${list.loading ? 'animate-spin' : ''}`} />
          </button>
        </Tip>
      </div>

      <div className="mt-6">
        {list.error ? (
          <p className="text-sm text-red-700">Could not load profiles: {list.error}</p>
        ) : !list.records ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : (
          <ProfilePicker records={records} value={selectedId} onValueChange={(id) => setParams({ profile: id }, { replace: true })} unsaved={unsaved} />
        )}
      </div>

      {!selectedId && list.records && (
        <p className="mt-6 rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500">
          Choose a profile to see its setup.
        </p>
      )}
      {selectedId && !record && (
        <p className={`mt-6 text-sm ${detailError ? 'text-red-700' : 'text-neutral-500'}`}>
          {detailError ? `Could not load this profile: ${detailError}` : 'Loading…'}
        </p>
      )}

      {record && (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border border-neutral-200 bg-white px-5 py-4">
            <div className="flex min-w-0 flex-wrap items-center gap-3">
              <span className="truncate text-lg font-semibold">{profileName(record)}</span>
              <StatusBadge status={text(record, 'Profile Status')} />
              <Progress record={record} />
              {isLive(record) && text(record, 'Setup Completed On') && (
                <span className="text-xs text-neutral-500 tabular-nums">Setup completed on {text(record, 'Setup Completed On')}</span>
              )}
            </div>
            {isLive(record) ? (
              <button type="button" disabled={reopening} onClick={() => reopen(record.id)} className={button.secondary}>
                {reopening ? 'Reopening…' : 'Reopen setup'}
              </button>
            ) : blocked ? (
              // not `disabled`, so the reason can still be read on hover and focus
              <Tip label={blocked}>
                <button type="button" aria-disabled className={`${button.primary} cursor-not-allowed opacity-50`}>
                  Verify &amp; complete
                </button>
              </Tip>
            ) : (
              <button type="button" onClick={() => setVerifying(true)} className={button.primary}>
                Verify &amp; complete
              </button>
            )}
            {actionError && (
              <p role="alert" className="w-full text-sm text-red-700">
                {actionError}
              </p>
            )}
          </div>

          {summary && (
            <section aria-labelledby="access-summary" className="mt-4 rounded-lg border border-neutral-200 bg-white px-5 py-4">
              <h2 id="access-summary" className="text-sm font-semibold">
                Access summary
              </h2>
              <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,3fr)] gap-x-4 gap-y-2 text-sm">
                {SUMMARY_FIELDS.filter((field) => text(summary, field)).map((field) => (
                  <div key={field} className="contents">
                    <dt className="text-neutral-500">{field}</dt>
                    <dd className="wrap-break-word whitespace-pre-line">{text(summary, field)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <div className="mt-4">
            <SetupBoxes
              // revealed secrets and per-box messages do not carry over to another profile
              key={record.id}
              record={record}
              draft={drafts[record.id] ?? {}}
              onDraft={(update) => setDrafts((current) => ({ ...current, [record.id]: update(current[record.id] ?? {}) }))}
              onSaved={stored}
              linkNames={linkNames}
            />
          </div>

          {verifying && (
            <VerifyDialog
              profile={{ id: record.id, name: profileName(record) }}
              onClose={() => setVerifying(false)}
              onCompleted={(saved) => {
                stored(saved)
                setVerifying(false)
              }}
            />
          )}
        </>
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
