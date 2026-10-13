import { ChevronRight, Copy, Link2 } from 'lucide-react'
import { Collapsible, Label } from 'radix-ui'
import { useRef, useState, type ReactNode } from 'react'
import { useFetch } from '../../data'
import { button, Combobox, input, Select, Tip } from '../../components/ui'
import { api, text, type ApiRecord } from '../../lib/api'
import { CALLS_TO_ACTION, credOf, locationChoice, LINK_PLACEHOLDER, linkPending, presetTexts, trackingFrom, type Draft } from './draft'
import type { AdAccount, Asset, AssetList, Assets } from './facebook'
import { RedtrackDuplicateDialog } from './RedtrackDuplicateDialog'

interface Props {
  draft: Draft
  onChange: (changes: Partial<Draft>) => void
  // the product's ad presets; undefined while loading
  presets?: ApiRecord[]
  // what the chosen Facebook token reaches
  assets: Assets
  // the chosen ad account, once Facebook has listed it
  account?: AdAccount
}

const select = 'mt-1.5 h-9.5 w-full'

interface RedtrackCampaign {
  id: string
  title?: string
  name?: string
  // the tracking link; its path and query become the tracking parameters
  trackback_url?: string
  // the first stream's first lander is the page the ads send people to
  streams?: { stream?: { landings?: { id?: string }[] } }[]
}

// What reading a RedTrack campaign came back with, shown under its field
interface RedtrackFill {
  state: 'loading' | 'done' | 'failed'
  message?: string
  // values RedTrack has that differ from what is already typed; offered, never forced
  offer?: Partial<Pick<Draft, 'websiteUrl' | 'tracking'>>
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <Label.Root htmlFor={id} className="text-sm font-medium">
        {label}
      </Label.Root>
      {children}
      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  )
}

interface AssetProps {
  id: string
  noun: string
  // what the list holds, for its search box: `ad accounts`
  plural: string
  value: string
  onValueChange: (value: string) => void
  // null while something this list depends on has not been chosen; `waitingFor` names it
  list: AssetList<Asset> | null
  waitingFor: string
}

// A dropdown filled live from Facebook, through our API
function AssetSelect({ id, noun, plural, value, onValueChange, list, waitingFor }: AssetProps) {
  const { items, loading, error }: AssetList<Asset> = list ?? { loading: false }
  const options: { value: string; label: string; detail?: string; badge?: string }[] = (items ?? []).map((asset) => ({
    value: asset.id,
    label: asset.name,
    detail: asset.id,
    badge: asset.state,
  }))
  // a value saved earlier stays visible even when Facebook's list cannot be loaded
  if (value && !options.some((option) => option.value === value)) options.unshift({ value, label: value })

  let placeholder = `Select ${noun}`
  if (!list) placeholder = `Choose ${waitingFor} first`
  else if (loading) placeholder = 'Loading from Facebook…'
  else if (error) placeholder = 'Could not load'

  return (
    <>
      <Combobox
        id={id}
        value={value}
        options={options}
        placeholder={placeholder}
        noun={plural}
        disabled={options.length === 0}
        onValueChange={onValueChange}
        className={select}
      />
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </>
  )
}

// Middle panel: where the campaign runs and what its ads say
export function SettingsPanel({ draft, onChange, presets, assets, account }: Props) {
  const preset = presets?.find((record) => record.id === draft.presetId)
  const texts = presetTexts(draft, preset)
  const pending = linkPending(draft, preset)
  const url = draft.websiteUrl.trim()

  // the URL already put into the texts, when the website URL has changed since
  const previous = draft.linkVariable.trim()
  const outdated = Boolean(previous && url && previous !== url && Object.values(texts).some((value) => value.includes(previous)))

  // Only this campaign's copy changes; the preset itself keeps its placeholder for the next campaign.
  // The campaign record keeps the URL (Link Variable), and the copy is made again from it after a reload.
  function replaceLink() {
    onChange({
      linkVariable: url,
      presetTexts: Object.fromEntries(
        Object.entries(texts).map(([name, value]) => {
          const replaced = value.replaceAll(LINK_PLACEHOLDER, url)
          return [name, outdated ? replaced.replaceAll(previous, url) : replaced]
        }),
      ),
    })
  }
  const hasToken = credOf(draft) !== ''
  const token = draft.tokenType === 'bm' ? 'a business manager' : 'a profile'
  const zone = account?.timezoneName
  const [duplicating, setDuplicating] = useState(false)
  const [fill, setFill] = useState<RedtrackFill>()
  // only the answer for the campaign picked last is used
  const latestPick = useRef('')

  // Picks a RedTrack campaign and fills the website URL and tracking parameters from it.
  // Empty fields are filled; a field that already holds something else is left alone and the value offered.
  async function pickRedtrack(redtrackId: string, redtrackName: string) {
    onChange({ redtrackId, redtrackName })
    latestPick.current = redtrackId
    setFill(redtrackId ? { state: 'loading' } : undefined)
    if (!redtrackId) return
    try {
      const picked = await api<RedtrackCampaign>(`/redtrack/campaigns/${encodeURIComponent(redtrackId)}`)
      const landerId = picked.streams?.[0]?.stream?.landings?.[0]?.id
      const lander = landerId ? await api<{ url?: string }>(`/redtrack/landings/${encodeURIComponent(landerId)}`) : undefined
      if (latestPick.current !== redtrackId) return

      const found = { websiteUrl: lander?.url?.trim() ?? '', tracking: trackingFrom(picked.trackback_url ?? '') }
      const filled: RedtrackFill['offer'] = {}
      const offer: RedtrackFill['offer'] = {}
      for (const key of ['websiteUrl', 'tracking'] as const) {
        if (!found[key] || found[key] === draft[key].trim()) continue
        if (draft[key].trim()) offer[key] = found[key]
        else filled[key] = found[key]
      }
      if (Object.keys(filled).length) onChange(filled)

      const missing = [!found.websiteUrl && 'a lander URL', !found.tracking && 'a tracking link'].filter(Boolean)
      setFill({
        state: 'done',
        message: missing.length ? `This RedTrack campaign has no ${missing.join(' and no ')}.` : undefined,
        offer: Object.keys(offer).length ? offer : undefined,
      })
    } catch (err) {
      if (latestPick.current === redtrackId) setFill({ state: 'failed', message: (err as Error).message })
    }
  }

  // RedTrack answers with a plain list or wraps it in `items`, depending on the route
  const redtrack = useFetch<RedtrackCampaign[] | { items?: RedtrackCampaign[] }>('/redtrack/campaigns?page=1&per=1000')
  const redtrackOptions = (Array.isArray(redtrack.data) ? redtrack.data : (redtrack.data?.items ?? [])).map((item) => ({
    value: item.id,
    label: item.title || item.name || item.id,
  }))
  // the campaign's saved choice stays visible even when RedTrack's list cannot be loaded
  if (draft.redtrackId && !redtrackOptions.some((option) => option.value === draft.redtrackId)) {
    redtrackOptions.unshift({ value: draft.redtrackId, label: draft.redtrackName || draft.redtrackId })
  }

  const location = locationChoice(draft.countries)

  return (
    <section className="rounded-lg border border-neutral-200 bg-white">
      <div className="border-b border-neutral-200 px-5 py-3">
        <h2 className="text-sm font-semibold">Campaign settings</h2>
      </div>

      <div className="space-y-5 px-5 py-5">
        <Field id="campaign-name" label="Campaign name">
          <input id="campaign-name" value={draft.name} onChange={(e) => onChange({ name: e.target.value })} className={`${input} mt-1.5`} />
        </Field>

        <Field id="campaign-redtrack" label="RedTrack campaign">
          <div className="mt-1.5 flex items-center gap-2">
            <Combobox
              id="campaign-redtrack"
              value={draft.redtrackId}
              options={redtrackOptions}
              placeholder={redtrack.loading ? 'Loading from RedTrack…' : redtrack.error ? 'Could not load RedTrack campaigns' : 'Search campaigns…'}
              noun="RedTrack campaigns"
              onValueChange={(redtrackId) =>
                void pickRedtrack(redtrackId, redtrackOptions.find((option) => option.value === redtrackId)?.label ?? '')
              }
              className="h-9.5 min-w-0 flex-1"
            />
            <Tip label="Duplicate a RedTrack campaign and use the copy">
              <button
                type="button"
                aria-label="Duplicate RedTrack campaign"
                onClick={() => setDuplicating(true)}
                className={`${button.secondary} size-9.5 px-0`}
              >
                <Copy className="size-4" />
              </button>
            </Tip>
          </div>
          {duplicating && (
            <RedtrackDuplicateDialog
              options={redtrackOptions}
              sourceId={draft.redtrackId}
              launcherName={draft.name}
              onClose={() => setDuplicating(false)}
              // picked like any other RedTrack campaign: empty fields are filled, typed ones are offered the values
              onCreated={(id, title) => void pickRedtrack(id, title)}
            />
          )}
          {redtrack.error && <p className="mt-1 text-xs text-red-700">{redtrack.error.message}</p>}
          {fill?.state === 'loading' && (
            <p role="status" className="mt-1 text-xs text-neutral-500">
              Reading the website URL and tracking parameters from RedTrack…
            </p>
          )}
          {fill?.state === 'failed' && (
            <p role="alert" className="mt-1 text-xs text-red-700">
              Could not read this campaign from RedTrack: {fill.message}
            </p>
          )}
          {fill?.state === 'done' && fill.message && <p className="mt-1 text-xs text-amber-800">{fill.message}</p>}
          {fill?.offer && (
            <div role="status" className="mt-2 rounded-md bg-blue-50 p-3 text-xs text-blue-900">
              <p className="font-medium">RedTrack has different values from the ones typed below:</p>
              <dl className="mt-1.5 space-y-1">
                {fill.offer.websiteUrl && (
                  <div>
                    <dt className="inline font-medium">Website URL: </dt>
                    <dd className="inline break-all">{fill.offer.websiteUrl}</dd>
                  </div>
                )}
                {fill.offer.tracking && (
                  <div>
                    <dt className="inline font-medium">Tracking parameters: </dt>
                    <dd className="inline font-mono break-all">{fill.offer.tracking}</dd>
                  </div>
                )}
              </dl>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onChange(fill.offer!)
                    setFill({ state: 'done' })
                  }}
                  className={`${button.primary} h-7 px-2 text-xs`}
                >
                  Use RedTrack values
                </button>
                <button type="button" onClick={() => setFill({ state: 'done' })} className={`${button.secondary} h-7 px-2 text-xs`}>
                  Keep mine
                </button>
              </div>
            </div>
          )}
        </Field>

        <fieldset className="space-y-4 rounded-md border border-neutral-200 p-4">
          <legend className="px-1 text-xs font-medium tracking-wide text-neutral-500 uppercase">Facebook</legend>
          <Field id="campaign-ad-account" label="Ad account">
            <AssetSelect
              id="campaign-ad-account"
              noun="an ad account"
              plural="ad accounts"
              value={draft.adAccountId}
              // a pixel belongs to an ad account, so changing the account clears it
              onValueChange={(adAccountId) => onChange({ adAccountId, pixelId: '' })}
              list={hasToken ? assets.accounts : null}
              waitingFor={token}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="campaign-pixel" label="Pixel">
              <AssetSelect
                id="campaign-pixel"
                noun="a pixel"
                plural="pixels"
                value={draft.pixelId}
                onValueChange={(pixelId) => onChange({ pixelId })}
                list={hasToken && draft.adAccountId ? assets.pixels : null}
                waitingFor={hasToken ? 'an ad account' : token}
              />
            </Field>
            <Field id="campaign-page" label="Page">
              <AssetSelect
                id="campaign-page"
                noun="a page"
                plural="pages"
                value={draft.pageId}
                onValueChange={(pageId) => onChange({ pageId })}
                list={hasToken ? assets.pages : null}
                waitingFor={token}
              />
            </Field>
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="campaign-date"
            // Facebook reads the start time in the ad account's own time zone, not the browser's
            label={`Start date and time (${zone ?? 'ad account time'})`}
            hint={zone ? `In the ad account's time zone, ${zone}.` : "Read in the ad account's time zone; choose an ad account to see which."}
          >
            <input
              id="campaign-date"
              type="datetime-local"
              value={draft.start}
              onChange={(e) => onChange({ start: e.target.value })}
              className={`${input} mt-1.5`}
            />
          </Field>
          <Field id="campaign-budget" label="Daily budget (USD)">
            <input
              id="campaign-budget"
              type="number"
              min={1}
              inputMode="decimal"
              value={draft.budget}
              onChange={(e) => onChange({ budget: e.target.value })}
              className={`${input} mt-1.5`}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="campaign-location" label="Location targeting">
            <Select
              id="campaign-location"
              value={location.value}
              options={location.options}
              placeholder="Select location…"
              onValueChange={(value) => onChange({ countries: value.split(',') })}
              className={select}
            />
          </Field>
          <Field id="campaign-cta" label="Call to action">
            <Select
              id="campaign-cta"
              value={draft.callToAction}
              options={CALLS_TO_ACTION.includes(draft.callToAction) ? CALLS_TO_ACTION : [draft.callToAction, ...CALLS_TO_ACTION]}
              onValueChange={(callToAction) => onChange({ callToAction })}
              className={select}
            />
          </Field>
        </div>

        <Collapsible.Root>
          <div className="flex flex-wrap items-center gap-2">
            <Label.Root htmlFor="campaign-preset" className="text-sm font-medium">
              Ad preset
            </Label.Root>
            {(draft.presetTexts || (previous && !pending)) && (
              <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800 ring-1 ring-blue-600/20 ring-inset">
                Edited for this campaign
              </span>
            )}
            {outdated && !pending && (
              <>
                <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-600/20 ring-inset">
                  Link outdated
                </span>
                <Tip label={`The texts still carry ${previous}. Put ${url} in its place.`}>
                  <button type="button" onClick={replaceLink} className={`${button.secondary} h-7 px-2 text-xs`}>
                    <Link2 className="size-3.5" />
                    Update link
                  </button>
                </Tip>
              </>
            )}
            {pending && (
              <>
                <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-600/20 ring-inset">
                  {LINK_PLACEHOLDER} not replaced
                </span>
                <Tip label={url ? `Put ${url} in place of every ${LINK_PLACEHOLDER}` : 'Enter the website URL first'}>
                  {/* a disabled button fires no pointer events, so the span carries the tooltip */}
                  <span tabIndex={url ? undefined : 0}>
                    <button type="button" disabled={!url} onClick={replaceLink} className={`${button.secondary} h-7 px-2 text-xs`}>
                      <Link2 className="size-3.5" />
                      Replace {LINK_PLACEHOLDER}
                    </button>
                  </span>
                </Tip>
              </>
            )}
            {preset && (
              <Collapsible.Trigger className="group ml-auto inline-flex items-center gap-1 rounded text-xs font-medium text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-blue-700">
                <ChevronRight className="size-3.5 group-data-[state=open]:rotate-90" />
                Preset texts
              </Collapsible.Trigger>
            )}
          </div>
          <Select
            id="campaign-preset"
            value={draft.presetId}
            options={(presets ?? []).map((record) => ({ value: record.id, label: text(record, 'Preset Name') || 'Untitled' }))}
            placeholder={!presets ? 'Loading…' : presets.length ? 'Select an ad preset' : 'This product has no ad presets'}
            disabled={!presets?.length}
            // a different preset starts again from its own texts, placeholder included
            onValueChange={(presetId) => onChange({ presetId, presetTexts: null, linkVariable: '' })}
            className={select}
          />
          <Collapsible.Content>
            <dl className="mt-3 space-y-2 rounded-md bg-neutral-50 p-3 text-sm">
              {Object.entries(texts).map(([name, value]) => (
                <div key={name}>
                  <dt className="text-xs text-neutral-500">{name}</dt>
                  <dd className="break-words whitespace-pre-wrap">{value}</dd>
                </div>
              ))}
            </dl>
          </Collapsible.Content>
        </Collapsible.Root>

        <Field id="campaign-url" label="Website URL">
          <input
            id="campaign-url"
            type="url"
            placeholder="https://example.com/landing"
            value={draft.websiteUrl}
            onChange={(e) => onChange({ websiteUrl: e.target.value })}
            className={`${input} mt-1.5`}
          />
        </Field>

        <Field id="campaign-tracking" label="Tracking parameters" hint="Added to the website URL on every ad.">
          <input
            id="campaign-tracking"
            placeholder="cmpid=…&sub1={{ad.id}}&utm_source=facebook&utm_medium=paid"
            value={draft.tracking}
            onChange={(e) => onChange({ tracking: e.target.value })}
            className={`${input} mt-1.5 font-mono text-xs`}
          />
        </Field>

        <Field id="campaign-display-link" label="Display link (optional)" hint="The address shown on the ad in place of the website URL.">
          <input
            id="campaign-display-link"
            value={draft.displayLink}
            onChange={(e) => onChange({ displayLink: e.target.value })}
            className={`${input} mt-1.5`}
          />
        </Field>
      </div>
    </section>
  )
}
