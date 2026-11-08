import { Check, ChevronDown, CircleAlert, Clock, Lock, Pencil } from 'lucide-react'
import { Popover } from 'radix-ui'
import { useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../../auth'
import { api, ApiError, text, type ApiRecord } from '../../lib/api'
import { button, Select, StatusBadge, Tip } from '../ui'
import {
  displayName,
  F,
  FB_EMAIL_SOURCES,
  fbEmailSource,
  formatDate,
  hasName,
  isDead,
  isLive,
  isLocked,
  parseOriginal,
  resolveFbEmail,
  rotation,
  stateOf,
  STATUSES,
  uidOf,
  type FbEmailSource,
  type Received,
  type ReceivedKey,
} from './model'
import { VerifyDialog } from './VerifyDialog'

// Unsaved edits of the Current column, by field name. A key is present only
// while its value differs from what is stored.
export type Draft = Record<string, string>

interface Props {
  record: ApiRecord
  draft: Draft
  onDraft: (update: (draft: Draft) => Draft) => void
  // the record as stored after a write
  onSaved: (record: ApiRecord) => void
  linkNames: Record<'Linked BM' | 'Linked Pages', Map<string, string>>
}

// Any value on the page copies with a click; nothing is masked
function CopyValue({ value, mono, muted, className = '' }: { value: string; mono?: boolean; muted?: boolean; className?: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1200)
    return () => clearTimeout(timer)
  }, [copied])
  if (!value) return <span className={`flex min-h-9 flex-1 items-center rounded-md px-2.5 text-sm text-neutral-400 italic ${className}`}>{muted ? 'Not supplied' : 'Not set'}</span>
  return (
    <Tip label={copied ? 'Copied' : 'Click to copy'}>
      <button
        type="button"
        onClick={() => navigator.clipboard.writeText(value).then(() => setCopied(true))}
        className={`flex min-h-9 min-w-0 flex-1 items-center rounded-md border px-2.5 py-1.5 text-left text-sm break-all hover:border-blue-700 hover:bg-white focus-visible:outline-2 focus-visible:outline-blue-700 ${mono ? 'font-mono text-[13px]' : ''} ${className}`}
      >
        <span className="line-clamp-2">{value}</span>
      </button>
    </Tip>
  )
}

// icon-only state of a Current value against the Received one; the words are on hover
function Marker({ current, received }: { current: string; received: string | undefined }) {
  if (!received) return <span className="size-4 shrink-0" />
  if (!current) {
    return (
      <Tip label="Empty. Needed for Fully rotated">
        <CircleAlert className="size-4 shrink-0 text-amber-600" aria-label="Empty" />
      </Tip>
    )
  }
  return current === received ? (
    <Tip label="Still the delivered value">
      <Clock className="size-4 shrink-0 text-amber-600" aria-label="Still the delivered value" />
    </Tip>
  ) : (
    <Tip label="Changed from the delivered value">
      <Check className="size-4 shrink-0 text-emerald-700" aria-label="Changed" />
    </Tip>
  )
}

const inputClass =
  'block min-h-9 w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-sm outline-none placeholder:text-neutral-400 focus:border-blue-700 focus:ring-1 focus:ring-blue-700'

export function ProfilePane({ record, draft, onDraft, onSaved, linkNames }: Props) {
  const { expire } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [editingName, setEditingName] = useState(false)
  const [name, setName] = useState('')
  const [verifying, setVerifying] = useState(false)
  // the Received column of a profile that arrived before the hub, typed in once and then locked
  const [receivedDraft, setReceivedDraft] = useState<Received>({})

  const received = parseOriginal(record.fields[F.original])
  const locked = isLocked(record)
  const stored = (field: string) => text(record, field)
  const current = (field: string) => (field in draft ? draft[field] : stored(field))
  const dirty = Object.keys(draft).length > 0
  const state = stateOf(record)
  const { done, total } = rotation(record)

  function set(field: string, value: string) {
    onDraft((draft) => {
      const next = { ...draft }
      if (value === stored(field)) delete next[field]
      else next[field] = value
      return next
    })
  }

  async function patch(fields: Record<string, unknown>) {
    setBusy(true)
    setError(undefined)
    try {
      onSaved(await api<ApiRecord>(`/data/profiles/${record.id}`, { method: 'PATCH', body: { fields } }))
      return true
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) expire()
      else setError((err as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function saveCurrent() {
    const fields: Record<string, unknown> = { ...draft }
    // the Facebook login address follows the chosen mailbox
    const source = (current(F.fbEmailSource) || 'received') as FbEmailSource
    const resolved = resolveFbEmail(source, received, current)
    if (resolved && resolved !== stored(F.fbEmail)) fields[F.fbEmail] = resolved
    if (!(F.fbEmailSource in fields) && stored(F.fbEmailSource) === '') fields[F.fbEmailSource] = source
    const sent = { ...draft }
    if (await patch(fields)) {
      onDraft((draft) => Object.fromEntries(Object.entries(draft).filter(([key, value]) => !(key in sent && sent[key] === value))))
    }
  }

  async function saveReceived() {
    const values = Object.fromEntries(Object.entries(receivedDraft).filter(([, v]) => v && v.trim()))
    if (Object.keys(values).length === 0) return
    if (await patch({ [F.original]: JSON.stringify(values, null, 2) })) setReceivedDraft({})
  }

  async function saveName() {
    setEditingName(false)
    if (name.trim() !== stored(F.name)) await patch({ [F.name]: name.trim() })
  }

  const links = (field: 'Linked BM' | 'Linked Pages') => ((record.fields[field] as string[] | undefined) ?? []).map((id) => linkNames[field].get(id) || id)
  const tokenValid = record.fields[F.tokenValid] === true
  const hasToken = record.fields[F.hasToken] === true

  const verifyBlocked = dirty ? 'Save or discard the unsaved changes first.' : state === 'rotated' ? '' : state === 'unrecorded' ? 'Record the received data first.' : `${total - done} of ${total} credentials are still as delivered.`

  // ---- the Received | Current table ----
  const receivedCell = (key: ReceivedKey, mono = false, multiline = false) =>
    locked || Object.keys(received).length ? (
      <CopyValue value={received[key] ?? ''} mono={mono} muted className="border-transparent bg-[#eef2f7] hover:border-blue-700" />
    ) : multiline ? (
      <textarea rows={2} value={receivedDraft[key] ?? ''} onChange={(e) => setReceivedDraft({ ...receivedDraft, [key]: e.target.value })} className={`${inputClass} font-mono text-[13px]`} />
    ) : (
      <input value={receivedDraft[key] ?? ''} autoComplete="off" onChange={(e) => setReceivedDraft({ ...receivedDraft, [key]: e.target.value })} className={`${inputClass} ${mono ? 'font-mono text-[13px]' : ''}`} />
    )

  const currentCell = (field: string, receivedKey: ReceivedKey | undefined, mono = false, multiline = false) => (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {multiline ? (
        <textarea
          rows={2}
          value={current(field)}
          spellCheck={false}
          onChange={(e) => set(field, e.target.value)}
          className={`${inputClass} ${mono ? 'font-mono text-[13px]' : ''} ${field in draft ? 'border-amber-500 ring-1 ring-amber-500' : ''}`}
        />
      ) : (
        <input
          value={current(field)}
          spellCheck={false}
          autoComplete="off"
          data-1p-ignore
          data-lpignore="true"
          onChange={(e) => set(field, e.target.value)}
          className={`${inputClass} ${mono ? 'font-mono text-[13px]' : ''} ${field in draft ? 'border-amber-500 ring-1 ring-amber-500' : ''}`}
        />
      )}
      {receivedKey && <Marker current={current(field)} received={received[receivedKey]} />}
    </div>
  )

  const row = (label: string, receivedNode: ReactNode, currentNode: ReactNode) => (
    <div className="grid grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)] items-start gap-x-3 px-4 py-1.5">
      <span className="pt-2 text-sm text-neutral-600">{label}</span>
      <div className="flex min-w-0">{receivedNode}</div>
      <div className="flex min-w-0">{currentNode}</div>
    </div>
  )

  const source = (current(F.fbEmailSource) || 'received') as FbEmailSource
  const fbEmailNow = resolveFbEmail(source, received, current)

  const stepper = (() => {
    const steps = [
      { key: 'received', label: 'Received', sub: locked ? `locked ${formatDate(stored(F.lockedAt))}` : 'not recorded' },
      { key: 'rotating', label: state === 'rotating' || state === 'received' ? `Rotating ${done}/${total}` : 'Rotating', sub: `${total - done} still as delivered` },
      { key: 'rotated', label: 'Fully rotated', sub: 'all credentials changed' },
      { key: 'live', label: 'Live', sub: isLive(record) ? `since ${formatDate(stored(F.setupCompletedOn))}` : 'Verify & complete' },
    ]
    const order = ['received', 'rotating', 'rotated', 'live']
    const at = state === 'unrecorded' ? -1 : state === 'received' ? 1 : order.indexOf(state)
    return (
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {steps.map((step, i) => {
          const complete = i < at || (state === 'live' && i <= 3)
          const now = i === at && state !== 'live'
          return (
            <li key={step.key} className="flex items-center gap-2">
              {i > 0 && <span className="h-px w-6 bg-neutral-300" />}
              <span className={`flex items-center gap-1.5 ${complete ? 'text-emerald-800' : now ? 'font-semibold text-blue-800' : 'text-neutral-400'}`}>
                <span className={`flex size-4 items-center justify-center rounded-full text-[10px] ${complete ? 'bg-emerald-600 text-white' : now ? 'bg-blue-700 text-white' : 'border border-neutral-300'}`}>{complete ? <Check className="size-3" strokeWidth={3} /> : i + 1}</span>
                {step.label}
                {(now || (complete && i === 0)) && <span className="text-xs font-normal text-neutral-500">· {step.sub}</span>}
              </span>
            </li>
          )
        })}
        {isDead(record) && <li className="ml-auto text-xs font-medium text-red-700">Dead · {stored(F.status)}</li>}
      </ol>
    )
  })()

  return (
    <div className="min-w-0 flex-1 space-y-4">
      {/* header */}
      <section className="rounded-lg border border-neutral-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          {editingName ? (
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={saveName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void saveName()
                if (e.key === 'Escape') setEditingName(false)
              }}
              aria-label="Profile name"
              className={`${inputClass} h-9 w-64 text-lg font-semibold`}
            />
          ) : (
            <h2 className={`truncate text-lg font-semibold ${hasName(record) ? '' : 'text-neutral-500 italic'}`} title={hasName(record) ? undefined : 'No name yet: Facebook sync fills it'}>
              {displayName(record)}
            </h2>
          )}
          <Tip label="Edit name">
            <button
              type="button"
              aria-label="Edit name"
              onClick={() => {
                setName(stored(F.name))
                setEditingName(true)
              }}
              className={button.icon}
            >
              <Pencil className="size-3.5" />
            </button>
          </Tip>
          {uidOf(record) && <span className="font-mono text-sm text-neutral-500">UID {uidOf(record)}</span>}

          <Popover.Root>
            <Popover.Trigger asChild>
              <button type="button" aria-label="Change status" className="inline-flex items-center gap-1 rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
                <StatusBadge status={stored(F.status) || 'No status'} />
                <ChevronDown className="size-3.5 text-neutral-500" />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="start" sideOffset={6} className="z-50 w-56 rounded-md border border-neutral-200 bg-white p-1 text-sm shadow-lg">
                {STATUSES.map((status) => (
                  <Popover.Close key={status} asChild>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void patch({ [F.status]: status })}
                      className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left hover:bg-neutral-100"
                    >
                      <StatusBadge status={status} />
                      {stored(F.status) === status && <Check className="size-4 text-blue-700" />}
                    </button>
                  </Popover.Close>
                ))}
                <p className="px-2 pt-1.5 pb-1 text-xs text-neutral-500">Inactive and Banned show under Dead.</p>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>

          <div className="ml-auto flex items-center gap-2">
            {isLive(record) ? (
              <button type="button" disabled={busy} onClick={() => void patch({ [F.setupComplete]: false, [F.setupCompletedOn]: '' })} className={button.secondary}>
                Reopen setup
              </button>
            ) : verifyBlocked ? (
              <Tip label={verifyBlocked}>
                <button type="button" aria-disabled className={`${button.primary} cursor-not-allowed opacity-50`}>
                  Verify &amp; complete
                </button>
              </Tip>
            ) : (
              <button type="button" onClick={() => setVerifying(true)} className={button.primary}>
                Verify &amp; complete
              </button>
            )}
          </div>
        </div>

        <div className="mt-4">{stepper}</div>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-neutral-200 pt-4 text-sm lg:grid-cols-4">
          <div>
            <dt className="text-xs text-neutral-500">Token</dt>
            <dd className="mt-0.5">
              {hasToken ? (
                <>
                  <span className={tokenValid ? 'font-medium text-emerald-800' : 'font-medium text-red-700'}>{tokenValid ? 'Valid' : 'Invalid'}</span>
                  {stored(F.tokenEnd) && <span className="text-neutral-500"> · expires {formatDate(stored(F.tokenEnd))}</span>}
                </>
              ) : (
                <span className="text-neutral-500">Not connected</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Last Sync</dt>
            <dd className="mt-0.5">{stored(F.lastSync) ? formatDate(stored(F.lastSync), true) : <span className="text-neutral-500">Never</span>}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Business Managers</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {links('Linked BM').length ? links('Linked BM').map((name) => <span key={name} className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700">{name}</span>) : <span className="text-neutral-500">None</span>}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Pages</dt>
            <dd className="mt-1 flex flex-wrap gap-1">
              {links('Linked Pages').length ? links('Linked Pages').map((name) => <span key={name} className="rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-700">{name}</span>) : <span className="text-neutral-500">None</span>}
            </dd>
          </div>
        </dl>
      </section>

      {/* credentials */}
      <section className="rounded-lg border border-neutral-200 bg-white">
        <div className="grid grid-cols-[150px_minmax(0,1fr)_minmax(0,1fr)] gap-x-3 border-b border-neutral-200 px-4 py-3">
          <span />
          <div className="border-t-2 border-blue-700 pt-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Lock className="size-3.5 text-neutral-500" /> Received
            </p>
            <p className="text-xs text-neutral-500">{locked ? `Locked ${formatDate(stored(F.lockedAt))} · read only` : Object.keys(received).length ? 'Read only' : 'Not recorded yet. Fill in and save once; it locks.'}</p>
          </div>
          <div className="pt-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Pencil className="size-3.5 text-neutral-500" /> Current
            </p>
            <p className="text-xs text-neutral-500">What the profile uses today</p>
          </div>
        </div>

        <div className="divide-y divide-neutral-100 py-1">
          <div className="py-1.5">
            <p className="px-4 pt-1 pb-0.5 text-[11px] font-semibold tracking-wider text-neutral-500 uppercase">Facebook</p>
            {row(
              'Facebook Email',
              receivedCell('email'),
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Select
                  label="Facebook email source"
                  value={source}
                  onValueChange={(value) => set(F.fbEmailSource, value)}
                  options={FB_EMAIL_SOURCES.map((option) => {
                    const address = resolveFbEmail(option.value, received, current)
                    return { value: option.value, label: `${option.label} · ${address || 'not set'}` }
                  })}
                  className={`h-9 min-w-0 flex-1 ${F.fbEmailSource in draft ? 'border-amber-500 ring-1 ring-amber-500' : ''}`}
                />
                <Marker current={fbEmailNow} received={received.email} />
              </div>,
            )}
            {row('Facebook Password', receivedCell('password', true), currentCell(F.fbPassword, 'password', true))}
            {row('2FA Key', receivedCell('twoFaKey', true), currentCell(F.twoFa, 'twoFaKey', true))}
            {row('Recovery Codes', <CopyValue value="" muted className="border-transparent bg-[#eef2f7]" />, currentCell(F.recoveryCodes, undefined, true, true))}
          </div>
          <div className="py-1.5">
            <p className="px-4 pt-1 pb-0.5 text-[11px] font-semibold tracking-wider text-neutral-500 uppercase">Mailbox</p>
            {row('Email', receivedCell('email'), currentCell(F.mailboxEmail, 'email'))}
            {row('Email Password', receivedCell('emailPassword', true), currentCell(F.mailboxPassword, 'emailPassword', true))}
          </div>
          <div className="py-1.5">
            <p className="px-4 pt-1 pb-0.5 text-[11px] font-semibold tracking-wider text-neutral-500 uppercase">Recovery mailbox</p>
            {row('Recovery Email', receivedCell('recoveryEmail'), currentCell(F.recoveryEmail, 'recoveryEmail'))}
            {row('Recovery Email Password', receivedCell('recoveryEmailPassword', true), currentCell(F.recoveryPassword, 'recoveryEmailPassword', true))}
          </div>
          <div className="py-1.5">
            <p className="px-4 pt-1 pb-0.5 text-[11px] font-semibold tracking-wider text-neutral-500 uppercase">Other</p>
            {row('Proxy', receivedCell('proxy', true), currentCell(F.proxy, 'proxy', true))}
            {row(
              'Cookies',
              receivedCell('cookies', true, true),
              <span className="flex min-h-9 flex-1 items-center px-2.5 text-sm text-neutral-400 italic">Superseded once the password changes.</span>,
            )}
            {row('Notes', <span className="flex min-h-9 flex-1 items-center px-2.5 text-sm text-neutral-400 italic">—</span>, currentCell(F.notes, undefined, false, true))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-neutral-200 px-4 py-3">
          <span className="mr-auto text-xs text-neutral-500">
            Click any value to copy it · last change {formatDate(record.updatedTime, true)}
          </span>
          {error && (
            <p role="alert" className="w-full text-sm text-red-700">
              {error}
            </p>
          )}
          {!locked && Object.keys(received).length === 0 && (
            <button type="button" disabled={busy || Object.values(receivedDraft).every((v) => !v?.trim())} onClick={() => void saveReceived()} className={button.secondary}>
              Save Received &amp; lock
            </button>
          )}
          <button type="button" disabled={!dirty || busy} onClick={() => onDraft(() => ({}))} className={button.secondary}>
            Discard
          </button>
          <button type="button" disabled={!dirty || busy} onClick={() => void saveCurrent()} className={button.primary}>
            {busy ? 'Saving…' : 'Save Current'}
          </button>
        </div>
      </section>

      {verifying && (
        <VerifyDialog
          profile={{ id: record.id, name: displayName(record) }}
          onClose={() => setVerifying(false)}
          onCompleted={(saved) => {
            onSaved(saved)
            setVerifying(false)
          }}
        />
      )}
    </div>
  )
}
