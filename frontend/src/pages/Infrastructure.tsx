import { KeyRound, LogIn, RefreshCw, Search } from 'lucide-react'
import { Label, Switch, ToggleGroup } from 'radix-ui'
import { useMemo, useState } from 'react'
import { useAuth } from '../auth'
import { DetailsPanel } from '../components/infrastructure/DetailsPanel'
import { useFacebookLogin, type ConnectResult, type SystemUserConnectResult } from '../components/infrastructure/facebookLogin'
import { Map as InfrastructureMap } from '../components/infrastructure/Map'
import { MasterProfile } from '../components/infrastructure/MasterProfile'
import { buildTree,itemKey, KINDS, useInfrastructure, type Kind } from '../components/infrastructure/model'
import { Tree } from '../components/infrastructure/Tree'
import { button, Tip } from '../components/ui'
import { api, ApiError } from '../lib/api'

const LISTS: { kind: Kind; list: 'profiles' | 'bms' | 'adAccounts' | 'pages' | 'pixels' }[] = [
  { kind: 'profile', list: 'profiles' },
  { kind: 'bm', list: 'bms' },
  { kind: 'adAccount', list: 'adAccounts' },
  { kind: 'page', list: 'pages' },
  { kind: 'pixel', list: 'pixels' },
]

const VIEW_KEY = 'ops.infrastructure.view'

// The Facebook routes and these tables answer admins only, so nobody else is shown the page
export function Infrastructure() {
  const { user } = useAuth()
  if (user?.role !== 'admin') {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Infrastructure</h1>
        <p className="mt-6 rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500">
          Infrastructure is for admins only.
        </p>
      </>
    )
  }
  return <AdminInfrastructure />
}

function AdminInfrastructure() {
  const { expire } = useAuth()
  const { data, error, loading, reload } = useInfrastructure()
  const facebook = useFacebookLogin()
  const [search, setSearch] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  // the picture of everything and its links, or the nested list; the choice is remembered
  const [view, setView] = useState(() => (localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'map'))
  const [selectedKey, setSelectedKey] = useState<string>()
  const [connecting, setConnecting] = useState(false)
  const [connected, setConnected] = useState<{ result?: ConnectResult; error?: string }>()
  const [connectingSystemUser, setConnectingSystemUser] = useState(false)
  const [systemUser, setSystemUser] = useState<{ result?: SystemUserConnectResult; error?: string }>()

  const tree = useMemo(() => data && buildTree(data, search, showHidden), [data, search, showHidden])
  const hiddenCount = data ? LISTS.reduce((sum, { list }) => sum + data[list].filter((item) => item.hidden).length, 0) : 0

  // The login popup, then the server swaps the short-lived token for a stored
  // long-lived one. Facebook decides who logged in, so the server picks the profile.
  async function connect() {
    const shortLivedToken = await facebook.login()
    const result = await api<ConnectResult>('/facebook/connect', { method: 'POST', body: { shortLivedToken } })
    reload()
    return result
  }

  async function connectFromPage() {
    setConnecting(true)
    setConnected(undefined)
    try {
      const result = await connect()
      setConnected({ result })
      // its details open as soon as the reloaded list holds it
      setSelectedKey(itemKey('profile', result.profileId))
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) expire()
      else setConnected({ error: (err as Error).message })
    } finally {
      setConnecting(false)
    }
  }

  // The system user popup, then the server swaps its code for the business's
  // system user token and stores it on that Business Manager
  async function connectSystemUserFromPage() {
    setConnectingSystemUser(true)
    setSystemUser(undefined)
    try {
      const code = await facebook.loginSystemUser()
      const result = await api<SystemUserConnectResult>('/facebook/connect-system-user', { method: 'POST', body: { code } })
      reload()
      setSystemUser({ result })
      setSelectedKey(itemKey('bm', result.bmRecordId))
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) expire()
      else setSystemUser({ error: (err as Error).message })
    } finally {
      setConnectingSystemUser(false)
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Infrastructure</h1>
          <p className="mt-1 text-sm text-neutral-600">Facebook profiles, their Business Managers, ad accounts, pixels and pages.</p>
        </div>
        <div className="flex items-center gap-2">
          <Tip label="Refresh">
            <button onClick={reload} disabled={loading} aria-label="Refresh" className={button.icon}>
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </Tip>
          <Tip label={facebook.problem ?? 'Sign in to Facebook to add a profile or renew its token'}>
            <button onClick={connectFromPage} disabled={!facebook.ready || connecting} className={button.primary}>
              <LogIn className="size-4" />
              {connecting ? 'Waiting for Facebook…' : 'Connect Facebook'}
            </button>
          </Tip>
          {facebook.systemUserReady && (
            <Tip label="Sign in as an admin of a business portfolio to store its system user token on that Business Manager">
              <button onClick={connectSystemUserFromPage} disabled={connecting || connectingSystemUser} className={button.secondary}>
                <KeyRound className="size-4" />
                {connectingSystemUser ? 'Waiting for Facebook…' : 'Connect system user'}
              </button>
            </Tip>
          )}
        </div>
      </div>

      {facebook.problem && (
        <p role="status" className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          The Facebook login is not available: {facebook.problem}
        </p>
      )}
      {connected?.error && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          Could not connect the Facebook login: {connected.error}
        </p>
      )}
      {connected?.result && (
        <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Connected as {connected.result.name} ({connected.result.fbUserId}). {connected.result.created ? 'A new profile was created. ' : ''}
          The token is stored and expires on {connected.result.tokenExpiresOn}. Sync the profile to load its Business Managers, ad accounts, pixels
          and pages.
        </p>
      )}

      {systemUser?.error && (
        <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          Could not connect the system user: {systemUser.error}
        </p>
      )}
      {systemUser?.result && (
        <p role="status" className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          Stored the system user token of {systemUser.result.bmName} ({systemUser.result.bmId}), as {systemUser.result.systemUserName}.{' '}
          {systemUser.result.created ? 'A new Business Manager was created. ' : ''}
          {systemUser.result.tokenExpiresOn ? `The token expires on ${systemUser.result.tokenExpiresOn}.` : 'The token never expires.'}
        </p>
      )}

      {data && <MasterProfile data={data} onChanged={reload} onSelect={setSelectedKey} />}

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="relative min-w-56 flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="search"
            aria-label="Search infrastructure"
            placeholder="Search by name, Facebook id or status…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="block h-9.5 w-full rounded-md border border-neutral-300 bg-white pr-3 pl-8 text-sm outline-none placeholder:text-neutral-400 focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
          />
        </div>
        <div className="flex items-center gap-2">
          <Switch.Root
            id="infra-show-hidden"
            checked={showHidden}
            onCheckedChange={setShowHidden}
            className="relative h-5 w-9 shrink-0 rounded-full bg-neutral-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 data-[state=checked]:bg-blue-700"
          >
            <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-4.5" />
          </Switch.Root>
          <Label.Root htmlFor="infra-show-hidden" className="text-sm">
            Show hidden{hiddenCount ? ` (${hiddenCount})` : ''}
          </Label.Root>
        </div>
        <ToggleGroup.Root
          type="single"
          value={view}
          // clicking the selected side again leaves it selected
          onValueChange={(next) => {
            if (!next) return
            localStorage.setItem(VIEW_KEY, next)
            setView(next)
          }}
          aria-label="How to show the infrastructure"
          className="ml-auto inline-flex rounded-md border border-neutral-300 bg-white p-0.5"
        >
          {[
            { value: 'map', label: 'Map' },
            { value: 'list', label: 'List' },
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
      </div>

      {data && (
        <p className="mt-4 text-sm text-neutral-600" aria-live="polite">
          {LISTS.map(({ kind, list }) => `${data[list].length.toLocaleString()} ${KINDS[kind].plural.toLowerCase()}`).join(' · ')}
        </p>
      )}

      <div className="mt-3">
        {error ? (
          <div role="alert" className="rounded-lg border border-dashed border-red-300 px-4 py-10 text-center text-sm text-red-700">
            <p>Could not load infrastructure: {error}</p>
            <button onClick={reload} className={`${button.secondary} mt-3`}>
              Try again
            </button>
          </div>
        ) : !data || !tree ? (
          <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500">Loading…</p>
        ) : tree.empty ? (
          <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500">
            {search.trim()
              ? 'Nothing matches the search.'
              : hiddenCount && !showHidden
                ? 'Everything is hidden. Turn on “Show hidden” to see it.'
                : 'No profiles yet. Connect a Facebook login to add the first one.'}
          </p>
        ) : view === 'map' ? (
          <InfrastructureMap data={data} search={search} showHidden={showHidden} selectedKey={selectedKey} onSelect={setSelectedKey} />
        ) : (
          <Tree data={data} tree={tree} selectedKey={selectedKey} onSelect={setSelectedKey} searching={search.trim() !== ''} />
        )}
      </div>

      {data && (
        <DetailsPanel
          item={selectedKey ? data.byKey.get(selectedKey) : undefined}
          data={data}
          onClose={() => setSelectedKey(undefined)}
          onSelect={setSelectedKey}
          onChanged={reload}
          facebook={facebook}
          connect={connect}
        />
      )}
    </>
  )
}
