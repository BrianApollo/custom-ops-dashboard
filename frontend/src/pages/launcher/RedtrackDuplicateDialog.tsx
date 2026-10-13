import { Dialog, Label } from 'radix-ui'
import { useState, type FormEvent } from 'react'
import { button, Combobox, input } from '../../components/ui'
import { api } from '../../lib/api'

interface Props {
  // RedTrack's campaigns, as the launcher's own list has them
  options: { value: string; label: string }[]
  // the campaign picked in the launcher, offered as the one to copy
  sourceId: string
  launcherName: string
  onClose: () => void
  // called as soon as the new campaign exists in RedTrack
  onCreated: (id: string, title: string) => void
}

interface Source {
  source_id?: string
  domain_id?: string
  tags?: unknown
  cost_model?: unknown
  redirect_type?: unknown
  integrations?: unknown
  integration_postback?: unknown
  rev_share?: unknown
  streams?: { stream?: { landings?: { id?: string }[]; offers?: { id?: string }[] } }[]
}

// RedTrack wraps some answers in `data`
const unwrap = <T,>(body: unknown) => ((body as { data?: T } | null)?.data ?? body) as T
const path = (id: string) => `/redtrack/campaigns/${encodeURIComponent(id)}`

// Copies a RedTrack campaign under a new name, with the first lander and offer of
// its first stream, and picks the copy for this campaign. Every call goes through
// our API, which holds the RedTrack key.
export function RedtrackDuplicateDialog({ options, sourceId, launcherName, onClose, onCreated }: Props) {
  const [source, setSource] = useState(sourceId)
  const [naming, setNaming] = useState<'launcher' | 'custom'>(launcherName.trim() ? 'launcher' : 'custom')
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  // set once the copy exists, whether or not the rest went through
  const [created, setCreated] = useState<string>()
  const title = (naming === 'launcher' ? launcherName : custom).trim()

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    let step = 'RedTrack could not be read'
    let newId: string | undefined
    try {
      const original = unwrap<Source>(await api(path(source)))
      const landerId = original.streams?.[0]?.stream?.landings?.[0]?.id
      const offerId = original.streams?.[0]?.stream?.offers?.[0]?.id

      step = 'RedTrack did not confirm the new campaign. Look in RedTrack before trying again, or there may be two'
      const made = unwrap<{ id?: string; _id?: string }>(
        await api('/redtrack/campaigns', {
          method: 'POST',
          body: {
            title,
            source_id: original.source_id,
            domain_id: original.domain_id,
            cost_model: original.cost_model,
            redirect_type: original.redirect_type ?? 1,
            ...(original.tags ? { tags: original.tags } : {}),
            ...(original.integrations ? { integrations: original.integrations } : {}),
            ...(original.integration_postback ? { integration_postback: original.integration_postback } : {}),
            ...(original.rev_share ? { rev_share: original.rev_share } : {}),
          },
        }),
      )
      newId = made.id ?? made._id
      if (!newId) throw new Error('no campaign id came back')
      // the copy exists from here on, so it is picked whatever happens next
      setCreated(newId)
      onCreated(newId, title)

      if (landerId || offerId) {
        step = `The campaign "${title}" (${newId}) was created in RedTrack and is now selected, but its lander and offer were not copied. Add them in RedTrack; duplicating again would make a second campaign`
        const stream = unwrap<{ id?: string; _id?: string }>(
          await api('/redtrack/streams', {
            method: 'POST',
            body: {
              campaign_id: newId,
              weight: 100,
              ...(landerId ? { landings: [{ id: landerId, weight: 100 }] } : {}),
              ...(offerId ? { offers: [{ id: offerId, weight: 100 }] } : {}),
            },
          }),
        )
        const streamId = stream.id ?? stream._id
        if (!streamId) throw new Error('no stream id came back')
        await api(path(newId), { method: 'PUT', body: { streams: [{ id: streamId, weight: 100 }] } })
      }
      onClose()
    } catch (err) {
      setError(`${step}: ${(err as Error).message}`)
      setBusy(false)
    }
  }

  return (
    // it cannot be closed half way through
    <Dialog.Root open onOpenChange={(open) => !open && !busy && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-xl">
          <Dialog.Title className="text-base font-semibold">Duplicate RedTrack campaign</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-neutral-600">
            Makes a new campaign in RedTrack with the same source, domain, lander and offer, and selects it here.
          </Dialog.Description>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div>
              <Label.Root htmlFor="redtrack-source" className="text-sm font-medium">
                Campaign to copy
              </Label.Root>
              <Combobox
                id="redtrack-source"
                value={source}
                options={options}
                placeholder="Search campaigns…"
                noun="RedTrack campaigns"
                onValueChange={setSource}
                className="mt-1.5 h-9.5"
              />
            </div>
            <fieldset>
              <legend className="text-sm font-medium">New campaign name</legend>
              <div className="mt-2 space-y-2 text-sm">
                <label className={`flex items-center gap-2 ${launcherName.trim() ? '' : 'text-neutral-400'}`}>
                  <input
                    type="radio"
                    name="redtrack-name"
                    checked={naming === 'launcher'}
                    disabled={!launcherName.trim()}
                    onChange={() => setNaming('launcher')}
                    className="accent-blue-700"
                  />
                  <span className="min-w-0 truncate">Same as this campaign: {launcherName.trim() || 'no name yet'}</span>
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" name="redtrack-name" checked={naming === 'custom'} onChange={() => setNaming('custom')} className="accent-blue-700" />
                  Another name
                </label>
                {naming === 'custom' && (
                  <input aria-label="New RedTrack campaign name" autoFocus value={custom} onChange={(e) => setCustom(e.target.value)} className={input} />
                )}
              </div>
            </fieldset>
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" disabled={busy} onClick={onClose} className={button.secondary}>
                {created ? 'Close' : 'Cancel'}
              </button>
              {!created && (
                <button type="submit" disabled={busy || !source || !title} className={button.primary}>
                  {busy ? 'Duplicating…' : 'Duplicate'}
                </button>
              )}
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
