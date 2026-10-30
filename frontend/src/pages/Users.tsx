import { KeyRound, Pencil, Plus, RefreshCw, Search } from 'lucide-react'
import { Dialog, Label, Switch } from 'radix-ui'
import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth'
import { DataTable, type Column } from '../components/DataTable'
import { button, input, Select, StatusBadge, Tip } from '../components/ui'
import { useFetch } from '../data'
import { api } from '../lib/api'
import { matchesSearch } from '../lib/search'

// the roles the API accepts, exactly as it stores them
const ROLES = ['Admin', 'Video Editor']
const MIN_PASSWORD = 8

interface User {
  id: string
  name: string | null
  email: string | null
  role: string | null
  active: boolean | null
}

const modal =
  'fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl'

function PasswordField({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <div>
      <Label.Root htmlFor={id} className="text-sm font-medium">
        Password
      </Label.Root>
      <input
        id={id}
        type="password"
        required
        minLength={MIN_PASSWORD}
        autoComplete="new-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${input} mt-1.5`}
      />
      <p className="mt-1 text-xs text-neutral-500">At least {MIN_PASSWORD} characters. It is never shown again, so pass it on now.</p>
    </div>
  )
}

interface UserDialogProps {
  // the user to edit; none when adding one
  user?: User
  // editing yourself: your own role and access cannot be taken away here
  isSelf: boolean
  onClose: () => void
  onSaved: () => void
}

function UserDialog({ user, isSelf, onClose, onSaved }: UserDialogProps) {
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [role, setRole] = useState(user?.role && ROLES.includes(user.role) ? user.role : ROLES[1])
  const [active, setActive] = useState(user?.active ?? true)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const profile = { name: name.trim(), email: email.trim(), role, active }
      if (user) await api(`/users/${user.id}`, { method: 'PATCH', body: profile })
      else await api('/users', { method: 'POST', body: { ...profile, password } })
      onSaved()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content aria-describedby={undefined} className={modal}>
          <Dialog.Title className="text-base font-semibold">{user ? 'Edit user' : 'Add user'}</Dialog.Title>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <Label.Root htmlFor="user-name" className="text-sm font-medium">
                Name
              </Label.Root>
              <input id="user-name" required autoFocus value={name} onChange={(e) => setName(e.target.value)} className={`${input} mt-1.5`} />
            </div>
            <div>
              <Label.Root htmlFor="user-email" className="text-sm font-medium">
                Email
              </Label.Root>
              <input
                id="user-email"
                type="email"
                required
                autoComplete="off"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`${input} mt-1.5`}
              />
              <p className="mt-1 text-xs text-neutral-500">What they sign in with.</p>
            </div>
            <div>
              <Label.Root htmlFor="user-role" className="text-sm font-medium">
                Role
              </Label.Root>
              <Select id="user-role" value={role} options={ROLES} disabled={isSelf} onValueChange={setRole} className="mt-1.5 h-9.5 w-full" />
              <p className="mt-1 text-xs text-neutral-500">
                {isSelf
                  ? 'You cannot change your own role.'
                  : role === 'Admin'
                    ? 'Sees and changes everything.'
                    : 'Sees only their own videos and uploads to them.'}
              </p>
            </div>
            {!user && <PasswordField id="user-password" value={password} onChange={setPassword} />}
            {user && (
              <div className="flex items-start gap-3">
                <Switch.Root
                  id="user-active"
                  checked={active}
                  disabled={isSelf}
                  onCheckedChange={setActive}
                  className="mt-0.5 h-5 w-9 shrink-0 rounded-full bg-neutral-300 p-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:opacity-60 data-[state=checked]:bg-blue-700"
                >
                  <Switch.Thumb className="block size-4 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-4" />
                </Switch.Root>
                <div>
                  <Label.Root htmlFor="user-active" className="text-sm font-medium">
                    Can sign in
                  </Label.Root>
                  <p className="text-xs text-neutral-500">
                    {isSelf ? 'You cannot switch off your own access.' : 'Switching this off signs them out everywhere at once.'}
                  </p>
                </div>
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close type="button" className={button.secondary}>
                Cancel
              </Dialog.Close>
              <button type="submit" disabled={busy} className={button.primary}>
                {busy ? 'Saving…' : user ? 'Save changes' : 'Add user'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function PasswordDialog({ user, onClose }: { user: User; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      await api(`/users/${user.id}/password`, { method: 'POST', body: { password } })
      onClose()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className={modal}>
          <Dialog.Title className="text-base font-semibold">Set a new password</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-neutral-600">
            For {user.name || user.email}. They are signed out everywhere and must sign in again with it.
          </Dialog.Description>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <PasswordField id="new-password" value={password} onChange={setPassword} />
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close type="button" className={button.secondary}>
                Cancel
              </Dialog.Close>
              <button type="submit" disabled={busy || password.length < MIN_PASSWORD} className={button.primary}>
                {busy ? 'Saving…' : 'Set password'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

// Who can sign in, as what, and their passwords. Admins only; the API refuses everyone else.
export function Users() {
  const { user: me } = useAuth()
  const isAdmin = me?.role === 'admin'
  const { data, error, loading, reload } = useFetch<{ users: User[] }>(isAdmin ? '/users' : null)
  const [search, setSearch] = useState('')
  // `{}` while adding a user
  const [editing, setEditing] = useState<{ user?: User } | null>(null)
  const [resetting, setResetting] = useState<User | null>(null)

  if (!isAdmin) return <p className="text-sm text-neutral-600">Only admins can manage users.</p>

  const term = search.trim().toLowerCase()
  const rows = (data?.users ?? []).filter((user) => matchesSearch(term, user.name, user.email))

  const columns: Column<User>[] = [
    {
      header: 'Name',
      cell: (user) => (
        <>
          {user.name || 'Unnamed'}
          {user.id === me?.id && <span className="ml-2 text-xs font-normal text-neutral-500">(you)</span>}
        </>
      ),
    },
    { header: 'Email', cell: (user) => user.email ?? '' },
    { header: 'Role', cell: (user) => user.role || <span className="text-neutral-400">None</span> },
    { header: 'Access', cell: (user) => <StatusBadge status={user.active ? 'Active' : 'Switched off'} /> },
    {
      header: 'Actions',
      align: 'right',
      cell: (user) => (
        <span className="-my-1 inline-flex items-center gap-1">
          <Tip label="Edit">
            <button aria-label={`Edit ${user.name ?? 'user'}`} onClick={() => setEditing({ user })} className={button.icon}>
              <Pencil className="size-4" />
            </button>
          </Tip>
          <Tip label="Set a new password">
            <button aria-label={`Set a new password for ${user.name ?? 'user'}`} onClick={() => setResetting(user)} className={button.icon}>
              <KeyRound className="size-4" />
            </button>
          </Tip>
        </span>
      ),
    },
  ]

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-neutral-600">Who can sign in to the dashboard, and as what.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative w-64">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-neutral-400" />
            <input
              type="search"
              aria-label="Search users"
              placeholder="Search by name or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="block w-full rounded-md border border-neutral-300 bg-white py-1.5 pr-3 pl-8 text-sm outline-none placeholder:text-neutral-400 focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
            />
          </div>
          <Tip label="Refresh">
            <button onClick={reload} disabled={loading} aria-label="Refresh" className={button.icon}>
              <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </Tip>
          <button onClick={() => setEditing({})} className={button.primary}>
            <Plus className="size-4" />
            Add User
          </button>
        </div>
      </div>

      <div className="mt-6">
        <DataTable
          key={term}
          columns={columns}
          rows={rows}
          rowKey={(user) => user.id}
          empty={error ? `Could not load users: ${error.message}` : !data ? 'Loading…' : term ? 'No user matches the search.' : 'No users yet.'}
          emptyIsError={Boolean(error)}
        />
      </div>

      {editing && (
        <UserDialog
          user={editing.user}
          isSelf={editing.user?.id === me?.id}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      )}
      {resetting && <PasswordDialog user={resetting} onClose={() => setResetting(null)} />}
    </>
  )
}
