import { Check, Copy, ExternalLink, Eye, EyeOff, KeyRound, LogIn, Pencil, RefreshCw, ShieldCheck, Star, X } from 'lucide-react'
import { Dialog, Label } from 'radix-ui'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../../auth'
import { api, ApiError, text } from '../../lib/api'
import { button, input, Tip } from '../ui'
import type { ConnectResult, FacebookLogin } from './facebookLogin'
import { daysUntil, KINDS, linked, RELATED, tokenState, when, type Data, type Item } from './model'
import { ItemBadges, ItemButton } from './parts'

interface Notice {
  tone: 'success' | 'error' | 'info'
  title: string
  lines?: { text: string; bad?: boolean }[]
}

const NOTICE_TONES = { success: 'bg-emerald-50 text-emerald-900', error: 'bg-red-50 text-red-800', info: 'bg-blue-50 text-blue-900' }

const plain = (...lines: (string | null | undefined)[]) => lines.flatMap((line) => (line ? [{ text: line }] : []))

interface PanelProps {
  data: Data
  onClose: () => void
  onSelect: (key: string) => void
  // something was written: load the lists again
  onChanged: () => void
  facebook: FacebookLogin
  // runs the Facebook login and stores the token; the page owns it
  connect: () => Promise<ConnectResult>
}

// The selected record, as a sheet on the right. It stays open while its lists reload.
export function DetailsPanel({ item, ...props }: PanelProps & { item: Item | undefined }) {
  return (
    <Dialog.Root open={Boolean(item)} onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/30" />
        <Dialog.Content aria-describedby={undefined} className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-xl outline-none">
          {/* a different record starts with no result showing and no form open */}
          {item && <Details key={item.key} item={item} {...props} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Tip label={copied ? 'Copied' : label}>
      <button
        aria-label={label}
        onClick={() =>
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          })
        }
        className="inline-flex size-6 items-center justify-center rounded text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-blue-700"
      >
        {copied ? <Check className="size-3.5 text-emerald-700" /> : <Copy className="size-3.5" />}
      </button>
    </Tip>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-neutral-200 pt-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  )
}

interface Fact {
  label: string
  value: string
  href?: string
}

function facts(item: Item): Fact[] {
  const { record } = item
  const field = (label: string, name: string): Fact => ({ label, value: text(record, name) })
  const time = (label: string, name: string): Fact => ({ label, value: when(text(record, name)) })
  const link = (label: string, name: string): Fact => ({ label, value: text(record, name), href: text(record, name) })
  const all: Record<Item['kind'], Fact[]> = {
    profile: [field('Email', 'Profile Email'), link('Profile link', 'Profile Link'), field('Review date', 'Profile Review Date')],
    bm: [field('Verification', 'Verification Status'), field('System user ID', 'System User ID')],
    adAccount: [
      field('Currency', 'Currency'),
      field('Timezone', 'Timezone'),
      {
        label: 'Amount spent',
        value:
          record.fields['Amount Spent'] === undefined
            ? ''
            : `${Number(record.fields['Amount Spent']).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${text(record, 'Currency')}`.trim(),
      },
      field('Account type', 'Account Type'),
      field('Disable reason', 'Disable Reason'),
    ],
    page: [
      { label: 'Fans', value: record.fields['Fan Count'] === undefined ? '' : Number(record.fields['Fan Count']).toLocaleString() },
      field('Verification', 'Verification Status'),
      link('Page link', 'Page Link'),
    ],
    pixel: [{ label: 'Last fired', value: when(text(record, 'Last Fired Time')) || 'Never' }, time('Created', 'Creation Time')],
  }
  return all[item.kind].filter((fact) => fact.value)
}

// only http(s) links are made clickable: these values are typed in by people
const safeHref = (href: string | undefined) => (href && /^https?:\/\//i.test(href) ? href : undefined)

function Details({ item, data, onClose, onSelect, onChanged, facebook, connect }: PanelProps & { item: Item }) {
  const { expire } = useAuth()
  const meta = KINDS[item.kind]
  const Icon = meta.icon
  // the action that is running, by name
  const [busy, setBusy] = useState<string>()
  const [notice, setNotice] = useState<Notice>()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(item.name)
  const [confirmingMaster, setConfirmingMaster] = useState(false)
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')

  const hasToken = Boolean(item.record.fields.hasToken)
  const synced = when(text(item.record, meta.syncedField))

  // Runs one action and shows what came back. Facebook's own message is the
  // error text, so it is shown as it is.
  async function run(action: string, work: () => Promise<Notice>) {
    setBusy(action)
    setNotice(undefined)
    try {
      setNotice(await work())
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) expire()
      else setNotice({ tone: 'error', title: (err as Error).message })
    } finally {
      setBusy(undefined)
      // also after a failure: a rejected token is marked on the profile
      onChanged()
    }
  }

  const patch = (fields: Record<string, unknown>) => api(`/data/${meta.table}/${item.id}`, { method: 'PATCH', body: { fields } })
  const facebookPath = item.kind === 'profile' ? `/facebook/profiles/${item.id}` : `/facebook/business-managers/${item.id}`

  function rename(event: FormEvent) {
    event.preventDefault()
    void run('rename', async () => {
      await patch({ [meta.nameField]: name.trim() })
      setRenaming(false)
      return { tone: 'success', title: `Renamed to ${name.trim()}.` }
    })
  }

  const toggleHidden = () =>
    run('hide', async () => {
      await patch({ Hidden: !item.hidden })
      return { tone: 'success', title: item.hidden ? 'Shown again.' : 'Hidden. Turn on “Show hidden” to see it in the list.' }
    })

  const sync = () =>
    run('sync', async () => {
      const res = await api<{
        counts: { bms: number; pages: number; adAccounts: number; pixels: number; errors: number }
        log: { message: string; level: 'info' | 'success' | 'error' }[]
      }>(`${facebookPath}/sync`, { method: 'POST' })
      const { counts } = res
      return {
        tone: counts.errors ? 'error' : 'success',
        title: `${counts.errors ? 'Synced with errors' : 'Synced'}: ${counts.bms} Business Managers, ${counts.adAccounts} ad accounts, ${counts.pixels} pixels, ${counts.pages} pages.`,
        lines: res.log.map((entry) => ({ text: entry.message, bad: entry.level === 'error' })),
      }
    })

  const checkToken = () =>
    run('check', async () => {
      const res = await api<{ valid: boolean; name: string | null; fbUserId: string | null; error: string | null }>(`${facebookPath}/token/check`)
      return res.valid
        ? { tone: 'success', title: `Facebook accepts this token. It belongs to ${res.name} (${res.fbUserId}).` }
        : { tone: 'error', title: 'Facebook rejected this token.', lines: plain(res.error) }
    })

  const validateToken = () =>
    run('validate', async () => {
      const res = await api<{ isValid: boolean; expiresOn: string | null; scopes?: string[]; fbUserId?: string | null }>(
        `${facebookPath}/token/validate`,
        { method: 'POST' },
      )
      if (!res.isValid) {
        return {
          tone: 'error',
          title: 'Facebook says this token is invalid or expired.',
          lines: plain('Connect the Facebook login again to store a new one.'),
        }
      }
      const days = res.expiresOn ? daysUntil(res.expiresOn) : undefined
      return {
        tone: 'success',
        title: res.expiresOn ? `Token is valid until ${res.expiresOn}${days === undefined ? '' : ` (${days} days left)`}.` : 'Token is valid and has no expiry date.',
        lines: plain(res.scopes?.length ? `Permissions: ${res.scopes.join(', ')}` : undefined),
      }
    })

  const refreshToken = () =>
    run('refresh', async () => {
      const res = await api<{ expiresOn: string; daysLeft: number }>(`${facebookPath}/token/refresh`, { method: 'POST' })
      return { tone: 'success', title: `Token refreshed. It expires on ${res.expiresOn} (${res.daysLeft} days).` }
    })

  const connectLogin = () =>
    run('connect', async () => {
      const res = await connect()
      // the login decides which profile gets the token, not the profile that is open
      if (res.profileId !== item.id) {
        return {
          tone: 'info',
          title: `That login is ${res.name} (${res.fbUserId}), not this profile.`,
          lines: plain(
            res.created ? 'A new profile was created for it and its token stored there.' : 'Its token was stored on the profile with that name or Facebook id.',
            'This profile was not changed.',
          ),
        }
      }
      return { tone: 'success', title: `Connected as ${res.name}. The token expires on ${res.tokenExpiresOn}.` }
    })

  const setMaster = () =>
    run('master', async () => {
      const fields = { 'Profile Record': [item.id] }
      if (data.masterRecordId) await api(`/data/master_profile/${data.masterRecordId}`, { method: 'PATCH', body: { fields } })
      else await api('/data/master_profile', { method: 'POST', body: { fields: { Name: 'Master Profile', ...fields } } })
      setConfirmingMaster(false)
      return { tone: 'success', title: `${item.name} is now the Master Profile.` }
    })

  const validateSystemToken = () =>
    run('validate', async () => {
      const res = await api<{ isValid: boolean }>(`${facebookPath}/system-user-token/validate`, { method: 'POST' })
      return res.isValid
        ? { tone: 'success', title: 'Facebook says the system user token is valid.' }
        : { tone: 'error', title: 'Facebook says the system user token is not valid.', lines: plain('Generate a new one, or paste one.') }
    })

  function saveSystemToken(event: FormEvent) {
    event.preventDefault()
    void run('paste', async () => {
      await api(`${facebookPath}/system-user-token`, { method: 'PUT', body: { token: pasted.trim() } })
      setPasted('')
      setPasting(false)
      return { tone: 'success', title: 'Facebook confirmed the token and it was saved.' }
    })
  }

  const generateSystemToken = () =>
    run('generate', async () => {
      const res = await api<{ result: string; systemUserId: string | null; systemUserName: string | null; message: string }>(
        `${facebookPath}/system-user-token/generate`,
        { method: 'POST' },
      )
      const who = res.systemUserName ?? res.systemUserId
      switch (res.result) {
        case 'success':
          return { tone: 'success', title: `System user token saved${who ? ` for ${who}` : ''}.` }
        case 'no_admin_profile':
          return {
            tone: 'error',
            title: 'No admin profile found.',
            lines: plain(res.message, 'Link and sync a profile that is an admin of this Business Manager and has a token, or paste a token made in Business Settings.'),
          }
        case 'cannot_create_system_user':
          return {
            tone: 'error',
            title: 'Facebook would not create a system user.',
            lines: plain(res.message, 'Create one in Business Settings under Users, System users, then generate again or paste its token.'),
          }
        case 'app_not_in_business':
          return {
            tone: 'error',
            title: 'The dashboard’s Facebook app is not added to this Business Manager.',
            lines: plain(res.message, 'Add the app in Business Settings under Accounts, Apps, then generate again.', who ? `System user: ${who}` : undefined),
          }
        default:
          return { tone: 'error', title: 'Facebook returned an error.', lines: plain(res.message) }
      }
    })

  const action = (id: string, label: string, working: string, icon: ReactNode, onClick: () => void, disabled = false) => (
    <button onClick={onClick} disabled={Boolean(busy) || disabled} className={button.secondary}>
      {icon}
      {busy === id ? working : label}
    </button>
  )

  const token = item.kind === 'profile' ? tokenState(item.record) : undefined
  const isMaster = item.kind === 'profile' && data.masterProfileId === item.id
  const systemUserCreated = when(text(item.record, 'System User Created'))

  return (
    <>
      <header className="border-b border-neutral-200 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-neutral-500 uppercase">
            <Icon className="size-4" />
            {meta.label}
          </p>
          <Dialog.Close aria-label="Close" className={`${button.icon} -mt-1 -mr-2`}>
            <X className="size-4" />
          </Dialog.Close>
        </div>

        {renaming ? (
          <form onSubmit={rename} className="mt-2">
            {/* the title stays for screen readers while the name is being edited */}
            <Dialog.Title className="sr-only">{item.name}</Dialog.Title>
            <Label.Root htmlFor="infra-rename" className="text-sm font-medium">
              Name
            </Label.Root>
            <input id="infra-rename" autoFocus required value={name} onChange={(e) => setName(e.target.value)} className={`${input} mt-1.5`} />
            {item.kind === 'profile' && <p className="mt-1 text-xs text-neutral-500">A sync sets a profile’s name back to its name on Facebook.</p>}
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setRenaming(false)
                  setName(item.name)
                }}
                className={button.secondary}
              >
                Cancel
              </button>
              <button type="submit" disabled={Boolean(busy) || !name.trim() || name.trim() === item.name} className={button.primary}>
                {busy === 'rename' ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        ) : (
          <div className="mt-1 flex items-center gap-1">
            <Dialog.Title className="min-w-0 truncate text-lg font-semibold">{item.name}</Dialog.Title>
            <Tip label="Rename">
              <button onClick={() => setRenaming(true)} aria-label="Rename" className={`${button.icon} shrink-0`}>
                <Pencil className="size-4" />
              </button>
            </Tip>
          </div>
        )}

        <p className="mt-1 flex items-center gap-1 text-sm text-neutral-600">
          {item.fbId ? (
            <>
              <span className="tabular-nums">{item.fbId}</span>
              <CopyButton value={item.fbId} label="Copy Facebook id" />
            </>
          ) : (
            'No Facebook id'
          )}
        </p>
        <div className="mt-2 flex flex-wrap gap-1">
          <ItemBadges data={data} item={item} />
        </div>
        <p className="mt-2 text-xs text-neutral-500">{synced ? `Last synced ${synced}` : 'Not synced yet'}</p>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
        {notice && (
          <div role={notice.tone === 'error' ? 'alert' : 'status'} className={`rounded-md px-3 py-2 text-sm ${NOTICE_TONES[notice.tone]}`}>
            <p className="font-medium wrap-break-word">{notice.title}</p>
            {notice.lines && notice.lines.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs">
                {notice.lines.map((line, i) => (
                  <li key={i} className={`wrap-break-word ${line.bad ? 'font-medium text-red-800' : ''}`}>
                    {line.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {facts(item).length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {facts(item).map((fact) => (
              <div key={fact.label} className="col-span-2 grid grid-cols-subgrid">
                <dt className="text-neutral-500">{fact.label}</dt>
                <dd className="min-w-0 wrap-break-word">
                  {safeHref(fact.href) ? (
                    <a href={safeHref(fact.href)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-blue-700 hover:underline">
                      Open <ExternalLink className="size-3.5" />
                    </a>
                  ) : (
                    fact.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {item.kind === 'profile' && token && (
          <>
            <Section title="Facebook token">
              <p className="text-sm text-neutral-700">{token.detail}</p>
              <div className="flex flex-wrap gap-2">
                <Tip label="Asks Facebook who the token belongs to. Changes nothing.">
                  {action('check', 'Check', 'Checking…', <ShieldCheck className="size-4" />, checkToken, !hasToken)}
                </Tip>
                <Tip label="Asks Facebook if the token is valid and when it expires, and saves the answer.">
                  {action('validate', 'Validate', 'Validating…', <KeyRound className="size-4" />, validateToken, !hasToken)}
                </Tip>
                <Tip label="Trades the stored token for a new long-lived one.">
                  {action('refresh', 'Refresh', 'Refreshing…', <RefreshCw className="size-4" />, refreshToken, !hasToken)}
                </Tip>
              </div>
              <div>
                <Tip label={facebook.problem ?? 'Opens Facebook’s login window'}>
                  {action('connect', 'Connect Facebook login', 'Waiting for Facebook…', <LogIn className="size-4" />, connectLogin, !facebook.ready)}
                </Tip>
                <p className="mt-1.5 text-xs text-neutral-500">
                  Sign in to Facebook as this person. The new token is stored on the profile whose Facebook id or name matches the login.
                </p>
              </div>
            </Section>

            <Section title="Sync from Facebook">
              <p className="text-sm text-neutral-700">
                Reads this profile’s Business Managers, ad accounts, pixels and pages from Facebook and updates the lists. Nothing is removed.
              </p>
              {action('sync', 'Sync from Facebook', 'Syncing…', <RefreshCw className={`size-4 ${busy === 'sync' ? 'animate-spin' : ''}`} />, sync, !hasToken)}
              {!hasToken && <p className="text-xs text-neutral-500">Connect a Facebook login first: there is no token to sync with.</p>}
            </Section>

            <Section title="Master Profile">
              {isMaster ? (
                <p className="text-sm text-neutral-700">This is the Master Profile. Scheduled actions, rules and anything not tied to a profile use its token.</p>
              ) : confirmingMaster ? (
                <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <p>Scheduled actions and rules will run with this profile’s token from now on. Campaigns it cannot manage will fail.</p>
                  <div className="mt-2 flex gap-2">
                    <button onClick={setMaster} disabled={Boolean(busy)} className={button.primary}>
                      {busy === 'master' ? 'Saving…' : 'Make it the Master Profile'}
                    </button>
                    <button onClick={() => setConfirmingMaster(false)} className={button.secondary}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {action('master', 'Set as Master Profile', 'Saving…', <Star className="size-4" />, () => setConfirmingMaster(true))}
                  {!hasToken && <p className="text-xs text-neutral-500">This profile has no token, so scheduled work would fail until one is connected.</p>}
                </>
              )}
            </Section>
          </>
        )}

        {item.kind === 'bm' && (
          <Section title="System user token">
            <p className="text-sm text-neutral-700">
              {hasToken ? `A token is stored${systemUserCreated ? `, saved ${systemUserCreated}` : ''}.` : 'No token is stored.'} The token itself is never shown.
            </p>
            <div className="flex flex-wrap gap-2">
              {hasToken && (
                <Tip label="Asks Facebook if the stored token is valid. Changes nothing.">
                  {action('validate', 'Check', 'Checking…', <ShieldCheck className="size-4" />, validateSystemToken)}
                </Tip>
              )}
              <Tip label="Finds or creates this Business Manager’s system user and stores a token for it">
                {action('generate', hasToken ? 'Generate again' : 'Generate', 'Generating…', <KeyRound className="size-4" />, generateSystemToken)}
              </Tip>
              {!pasting && action('paste', 'Paste a token', 'Saving…', <Pencil className="size-4" />, () => setPasting(true))}
            </div>
            {pasting && (
              <form onSubmit={saveSystemToken}>
                <Label.Root htmlFor="infra-system-token" className="text-sm font-medium">
                  System user token
                </Label.Root>
                {/* masked, never filled with the stored token, and cleared once saved */}
                <input
                  id="infra-system-token"
                  type="password"
                  autoComplete="off"
                  autoFocus
                  required
                  value={pasted}
                  onChange={(e) => setPasted(e.target.value)}
                  className={`${input} mt-1.5`}
                />
                <p className="mt-1 text-xs text-neutral-500">
                  Facebook is asked to confirm the token before it is saved{hasToken ? '. It replaces the stored one' : ''}.
                </p>
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPasting(false)
                      setPasted('')
                    }}
                    className={button.secondary}
                  >
                    Cancel
                  </button>
                  <button type="submit" disabled={Boolean(busy) || !pasted.trim()} className={button.primary}>
                    {busy === 'paste' ? 'Checking with Facebook…' : 'Validate and save'}
                  </button>
                </div>
              </form>
            )}
          </Section>
        )}

        {RELATED[item.kind].map((kind) => {
          const items = linked(data, item, kind)
          return (
            <Section key={kind} title={`${KINDS[kind].plural} (${items.length})`}>
              {items.length ? (
                <ul className="-mx-2 space-y-0.5">
                  {items.map((other) => (
                    <li key={other.key}>
                      <ItemButton data={data} item={other} onSelect={onSelect} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-neutral-500">None linked.</p>
              )}
            </Section>
          )
        })}
      </div>

      <footer className="flex items-center justify-between gap-2 border-t border-neutral-200 px-5 py-3">
        {action(
          'hide',
          item.hidden ? 'Unhide' : 'Hide',
          'Saving…',
          item.hidden ? <Eye className="size-4" /> : <EyeOff className="size-4" />,
          toggleHidden,
        )}
        <button onClick={onClose} className={button.secondary}>
          Close
        </button>
      </footer>
    </>
  )
}
