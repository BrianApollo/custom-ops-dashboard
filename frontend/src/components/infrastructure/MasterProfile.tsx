import { Star } from 'lucide-react'
import { Dialog, Label } from 'radix-ui'
import { useState, type FormEvent } from 'react'
import { api } from '../../lib/api'
import { button, Select } from '../ui'
import { itemKey, tokenState, type Data } from './model'
import { Badge } from './parts'

interface Props {
  data: Data
  // the Master Profile changed, so the lists should be read again
  onChanged: () => void
  // opens an item's details
  onSelect: (key: string) => void
}

// The profile whose token is used when nothing names one: scheduled budget and
// status changes, scaling rules, and any page left on "Master profile".
export function MasterProfile({ data, onChanged, onSelect }: Props) {
  const [changing, setChanging] = useState(false)
  const master = data.profiles.find((profile) => profile.id === data.masterProfileId)
  const token = master && tokenState(master.record)

  return (
    <section className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-neutral-200 bg-white px-4 py-3">
      <div className="min-w-0 flex-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Star className="size-4 text-blue-700" />
          Master profile
        </h2>
        <p className="mt-0.5 text-sm text-neutral-600">Scheduled actions, scaling rules and anything not tied to a profile use this profile's token.</p>
      </div>
      {master && token ? (
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={() => onSelect(itemKey('profile', master.id))} className="min-w-0 truncate text-sm font-medium hover:text-blue-800 hover:underline">
            {master.name}
          </button>
          <Badge tone={token.tone}>{token.label}</Badge>
        </div>
      ) : (
        <p role="status" className="rounded-md bg-amber-50 px-2.5 py-1 text-sm text-amber-900">
          {data.masterProfileId ? 'The Master Profile points at a profile that no longer exists.' : 'None is set, so scheduled actions and rules cannot run.'}
        </p>
      )}
      <button onClick={() => setChanging(true)} className={button.secondary}>
        {master ? 'Change' : 'Set Master Profile'}
      </button>

      {changing && (
        <ChangeDialog
          data={data}
          onClose={() => setChanging(false)}
          onSaved={() => {
            setChanging(false)
            onChanged()
          }}
        />
      )}
    </section>
  )
}

function ChangeDialog({ data, onClose, onSaved }: { data: Data; onClose: () => void; onSaved: () => void }) {
  const [profileId, setProfileId] = useState(data.profiles.some((profile) => profile.id === data.masterProfileId) ? data.masterProfileId! : '')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  // hidden profiles are retired ones; the current choice stays listed even if it has been hidden since
  const options = data.profiles
    .filter((profile) => !profile.hidden || profile.id === data.masterProfileId)
    .map((profile) => ({ value: profile.id, label: `${profile.name} · ${tokenState(profile.record).label}` }))
  const chosen = data.profiles.find((profile) => profile.id === profileId)
  const token = chosen && tokenState(chosen.record)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const fields = { 'Profile Record': [profileId] }
      // there is one Master Profile row; it is created the first time one is chosen
      if (data.masterRecordId) await api(`/data/master_profile/${data.masterRecordId}`, { method: 'PATCH', body: { fields } })
      else await api('/data/master_profile', { method: 'POST', body: { fields: { Name: 'Master Profile', ...fields } } })
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
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl">
          <Dialog.Title className="text-base font-semibold">Master profile</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-neutral-600">
            From the moment this is saved, scheduled budget and status changes, scaling rules and pages left on “Master profile” act on Facebook as this
            profile. It can only reach the ad accounts this profile has access to.
          </Dialog.Description>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <Label.Root htmlFor="master-profile" className="text-sm font-medium">
                Profile
              </Label.Root>
              <Select
                id="master-profile"
                value={profileId}
                options={options}
                placeholder={options.length ? 'Select a profile' : 'No profiles yet'}
                disabled={options.length === 0}
                onValueChange={setProfileId}
                className="mt-1.5 h-9.5 w-full"
              />
            </div>
            {token && token.tone !== 'green' && (
              <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {chosen.name}: {token.label}. {token.detail} Scheduled actions and rules will fail until this profile has a working token.
              </p>
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
              <button type="submit" disabled={busy || !profileId || profileId === data.masterProfileId} className={button.primary}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
