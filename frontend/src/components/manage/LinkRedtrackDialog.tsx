import { Dialog, Label } from 'radix-ui'
import { useState, type FormEvent } from 'react'
import { useFetch, useWorkspace } from '../../data'
import { api, text, type ApiRecord } from '../../lib/api'
import { withCred } from '../../lib/facebook'
import { button, Combobox } from '../ui'

interface RedtrackCampaign {
  id: string
  title?: string
  name?: string
}

interface Props {
  // the Facebook campaign being linked
  campaign: { id: string; name: string; adAccountId: string }
  // our record for it, when one exists already; otherwise one is created
  record?: ApiRecord
  // whose token reads the campaign from Facebook for the snapshot
  cred: string
  // the chosen profile's record id, noted on a new record; none for the Master Profile
  profileId?: string
  onClose: () => void
  onLinked: () => void
}

// Launch Date as the launcher writes it: the day, in the browser's zone
function today() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

// Tells us which RedTrack campaign tracks a Facebook campaign, so its numbers
// can be shown. A campaign launched outside the dashboard has no record here
// yet: one is made, with a snapshot of the campaign read from Facebook.
export function LinkRedtrackDialog({ campaign, record, cred, profileId, onClose, onLinked }: Props) {
  const { products } = useWorkspace()
  // RedTrack answers with a plain list or wraps it in `items`, depending on the route
  const redtrack = useFetch<RedtrackCampaign[] | { items?: RedtrackCampaign[] }>('/redtrack/campaigns?page=1&per=1000')
  const [redtrackId, setRedtrackId] = useState(record ? text(record, 'RedTrack Campaign Id') : '')
  const [productId, setProductId] = useState((record?.fields.Product as string[] | undefined)?.[0] ?? '')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const options = (Array.isArray(redtrack.data) ? redtrack.data : (redtrack.data?.items ?? []))
    .map((item) => ({ value: item.id, label: item.title || item.name || item.id, detail: item.id }))
    // RedTrack ids grow over time, so this puts the newest campaigns first
    .sort((a, b) => b.value.localeCompare(a.value))

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(undefined)
    try {
      const link = {
        'RedTrack Campaign Id': redtrackId,
        'RedTrack Campaign Name': options.find((option) => option.value === redtrackId)?.label ?? '',
        ...(productId ? { Product: [productId] } : {}),
      }
      if (record) {
        await api(`/data/campaigns/${record.id}`, { method: 'PATCH', body: { fields: link } })
      } else {
        // The snapshot is extra: a campaign Facebook will not show this token is still linked
        const snapshot = await api<Record<string, unknown>>(
          withCred(`/facebook/campaigns/${campaign.id}/import-snapshot`, cred, { adAccountId: campaign.adAccountId }),
        ).catch(() => null)
        if (snapshot) {
          snapshot.redtrack = { campaignId: redtrackId, campaignName: link['RedTrack Campaign Name'] }
          // Facebook often will not name a pixel asked for by id, so the ad account's own list is tried
          const pixel = (snapshot.facebook as { pixel?: { id?: string; name?: string } } | undefined)?.pixel
          if (pixel?.id && !pixel.name) {
            const pixels = await api<{ id: string; name: string }[]>(
              withCred(`/facebook/ad-accounts/${encodeURIComponent(campaign.adAccountId)}/pixels`, cred),
            ).catch(() => [])
            pixel.name = pixels.find((item) => item.id === pixel.id)?.name ?? ''
          }
        }
        await api('/data/campaigns', {
          method: 'POST',
          body: {
            fields: {
              Name: campaign.name,
              Status: 'Launched',
              Platform: 'Facebook',
              'FB Campaign ID': campaign.id,
              'FB Ad Account ID': campaign.adAccountId,
              'Launched Data': snapshot ? JSON.stringify(snapshot) : 'This campaign is launched without using Launcher',
              'Launch Date': today(),
              ...(profileId ? { 'Launch Profile ID': profileId } : {}),
              ...link,
            },
          },
        })
      }
      onLinked()
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const fixed = [
    { label: 'Facebook campaign ID', value: campaign.id },
    { label: 'Facebook campaign name', value: campaign.name },
    { label: 'Ad account ID', value: campaign.adAccountId },
  ]

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 z-50 max-h-[90vh] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
          <Dialog.Title className="text-base font-semibold">Link RedTrack campaign</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-neutral-600">
            {record
              ? 'Sets which RedTrack campaign tracks this campaign, so its cost, revenue and ROAS can be shown.'
              : 'This campaign was not launched from here. Linking it adds it to the dashboard’s campaigns as Launched, with its settings read from Facebook.'}
          </Dialog.Description>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <dl className="space-y-1.5 rounded-md bg-neutral-50 px-3 py-2.5 text-sm">
              {fixed.map((item) => (
                <div key={item.label} className="flex gap-3">
                  <dt className="w-44 shrink-0 text-neutral-500">{item.label}</dt>
                  <dd className="min-w-0 break-all tabular-nums">{item.value}</dd>
                </div>
              ))}
            </dl>
            <div>
              <Label.Root htmlFor="link-redtrack" className="text-sm font-medium">
                RedTrack campaign
              </Label.Root>
              <Combobox
                id="link-redtrack"
                value={redtrackId}
                options={options}
                placeholder={redtrack.loading ? 'Loading from RedTrack…' : redtrack.error ? 'Could not load RedTrack campaigns' : 'Search campaigns…'}
                noun="RedTrack campaigns"
                onValueChange={setRedtrackId}
                className="mt-1.5 h-9.5 w-full"
              />
              {redtrack.error && <p className="mt-1 text-xs text-red-700">{redtrack.error.message}</p>}
            </div>
            <div>
              <Label.Root htmlFor="link-product" className="text-sm font-medium">
                Product
              </Label.Root>
              <Combobox
                id="link-product"
                value={productId}
                options={products.map((product) => ({ value: product.id, label: product.name }))}
                placeholder="Select product"
                noun="products"
                onValueChange={setProductId}
                className="mt-1.5 h-9.5 w-full"
              />
              <p className="mt-1 text-xs text-neutral-500">Optional, but needed before ads can be added to this campaign from here.</p>
            </div>
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Dialog.Close type="button" className={button.secondary}>
                Cancel
              </Dialog.Close>
              <button type="submit" disabled={busy || !redtrackId} className={button.primary}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
