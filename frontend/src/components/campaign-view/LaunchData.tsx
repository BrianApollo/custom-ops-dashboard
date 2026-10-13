import { RefreshCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { api, text, type ApiRecord } from '../../lib/api'
import { withCred } from '../../lib/facebook'
import { button, StatusBadge } from '../ui'
import { alertBox, dollars, messageOf, title, type Snapshot } from './shared'

interface Props {
  record: ApiRecord
  snapshot: Snapshot | null
  productName?: string
  // names for the ids the record stores, where a profile is known by name
  profileNames: Map<string, string>
  cred: string
  // the snapshot was rewritten, so the page should read the record again
  onSynced: () => void
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  const empty = children === '' || children === undefined || children === null
  return (
    <div className="min-w-0">
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="mt-0.5 wrap-break-word">{empty ? <span className="text-neutral-400">—</span> : children}</dd>
    </div>
  )
}

const card = 'rounded-lg border border-neutral-200 bg-white p-4 text-sm'
const grid = 'mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3'

// `Name` with its id beside it; either may be missing
function named(ref: { id?: string; name?: string } | undefined) {
  if (!ref?.id && !ref?.name) return ''
  return (
    <>
      {ref.name || 'Unnamed'}
      {ref.id && <span className="ml-2 text-xs text-neutral-500 tabular-nums">{ref.id}</span>}
    </>
  )
}

function when(value: string | undefined) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function Texts({ label, items }: { label: string; items?: string[] }) {
  if (!items?.length) return null
  return (
    <details className="rounded-md border border-neutral-200">
      <summary className="cursor-pointer px-3 py-2 font-medium">
        {label} ({items.length})
      </summary>
      <ol className="list-decimal space-y-2 border-t border-neutral-200 py-2 pr-3 pl-8 whitespace-pre-wrap text-neutral-700">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ol>
    </details>
  )
}

// The settings saved on our campaign record, and the snapshot taken when it was launched
export function LaunchData({ record, snapshot, productName, profileNames, cred, onSynced }: Props) {
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string>()
  const fbCampaignId = text(record, 'FB Campaign ID')
  const adAccountId = text(record, 'FB Ad Account ID') || text(record, 'Ad Acc Used')
  // a snapshot written by a real launch is the record of what was sent, and is never overwritten
  const canSync = Boolean(fbCampaignId && adAccountId) && (!snapshot || snapshot.importedFromFacebook === true)

  async function sync() {
    setSyncing(true)
    setError(undefined)
    try {
      const rebuilt = await api<Snapshot>(withCred(`/facebook/campaigns/${fbCampaignId}/import-snapshot`, cred, { adAccountId }))
      await api(`/data/campaigns/${record.id}`, { method: 'PATCH', body: { fields: { 'Launched Data': JSON.stringify(rebuilt) } } })
      onSynced()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setSyncing(false)
    }
  }

  const syncButton = canSync && (
    <button onClick={sync} disabled={syncing} className={`${button.secondary} h-8`}>
      <RefreshCw className={`size-4 ${syncing ? 'animate-spin' : ''}`} />
      {syncing ? 'Syncing…' : 'Sync from Facebook'}
    </button>
  )

  const profileId = text(record, 'Launch Profile ID')
  const date = text(record, 'Launch Date')
  const result = snapshot?.result
  const failed = [...(snapshot?.media?.videos?.failed ?? []), ...(snapshot?.media?.images?.failed ?? [])]
  // the stored `success` flag is always true, so the outcome is read from the counts
  const outcome = !result
    ? ''
    : result.adsAttempted && !result.adsCreated
      ? 'Failed'
      : result.adsFailed || result.partialSuccess || failed.length
        ? 'Partial'
        : 'Success'

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className={alertBox}>
          Could not sync from Facebook: {error}
        </p>
      )}

      <section className={card}>
        <h2 className="text-sm font-semibold">Stored settings</h2>
        <dl className={grid}>
          <Field label="Product">{productName}</Field>
          <Field label="Platform">{text(record, 'Platform')}</Field>
          <Field label="Budget">{record.fields.Budget == null ? '' : `${dollars(Number(record.fields.Budget))} / day`}</Field>
          <Field label="Planned start">{[date.slice(0, 10), text(record, 'Launch Time')].filter(Boolean).join(' ')}</Field>
          <Field label="Launched">{when(text(record, 'Launched At') || snapshot?.launchedAt)}</Field>
          <Field label="Location targeting">{text(record, 'Location Targeting')}</Field>
          <Field label="Call to action">{text(record, 'CTA')}</Field>
          <Field label="Website URL">{text(record, 'Website Url')}</Field>
          <Field label="Display link">{text(record, 'Display Link')}</Field>
          <Field label="Tracking parameters">{text(record, 'UTMs')}</Field>
          <Field label="RedTrack campaign">{named({ id: text(record, 'RedTrack Campaign Id'), name: text(record, 'RedTrack Campaign Name') })}</Field>
          <Field label="Launch profile">{profileId ? named({ id: profileId, name: profileNames.get(profileId) }) : ''}</Field>
          <Field label="Ad account">{adAccountId}</Field>
          <Field label="Page">{text(record, 'Page Used')}</Field>
          <Field label="Pixel">{text(record, 'Pixel Used')}</Field>
          <Field label="Facebook campaign ID">{fbCampaignId}</Field>
          <Field label="Reuse creatives">{record.fields['Reuse Creatives'] ? 'Yes' : 'No'}</Field>
          <Field label="Launch as active">{record.fields['Launch As Active'] ? 'Yes' : 'No'}</Field>
        </dl>
      </section>

      {!snapshot ? (
        <section className={`${card} flex flex-wrap items-center gap-3`}>
          <p className="flex-1 text-neutral-600">
            {canSync
              ? 'This campaign was launched outside the launcher, so it has no launch snapshot. Sync from Facebook to record its ads and settings.'
              : 'This campaign has no launch snapshot.'}
          </p>
          {syncButton}
        </section>
      ) : (
        <>
          <section className={card}>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-sm font-semibold">Launch snapshot</h2>
              {outcome && <StatusBadge status={outcome} />}
              {snapshot.importedFromFacebook && <StatusBadge status="Imported from Facebook" />}
              <span className="flex-1 text-neutral-600">
                {result && `${result.adsCreated ?? 0} of ${result.adsAttempted ?? 0} ads created`}
                {snapshot.launchedAt && ` · ${when(snapshot.launchedAt)}`}
              </span>
              {syncButton}
            </div>
            {(result?.errors?.length ?? 0) > 0 && (
              <ul className={`${alertBox} mt-3 space-y-0.5`}>
                {result?.errors?.map((item, i) => (
                  <li key={i}>
                    {item.mediaName}: {item.message} {item.stage && `(${item.stage})`}
                  </li>
                ))}
              </ul>
            )}
            <dl className={grid}>
              <Field label="Campaign">{named(snapshot.facebook?.campaign) || snapshot.config?.campaignName}</Field>
              <Field label="Budget">{snapshot.config?.budgetCents ? `${dollars(snapshot.config.budgetCents / 100)} / day` : ''}</Field>
              <Field label="Launched as">{snapshot.config?.launchStatus ? title(snapshot.config.launchStatus) : ''}</Field>
              <Field label="Ad set">{named(snapshot.facebook?.adSet)}</Field>
              <Field label="Targeting">{snapshot.config?.geo?.join(', ')}</Field>
              <Field label="Start">{[snapshot.config?.startDate, snapshot.config?.startTime].filter(Boolean).join(' ')}</Field>
              <Field label="Ad account">{named(snapshot.facebook?.adAccount)}</Field>
              <Field label="Page">{named(snapshot.facebook?.page)}</Field>
              <Field label="Pixel">{named(snapshot.facebook?.pixel)}</Field>
              <Field label="Launched by">
                {snapshot.facebook?.systemUser?.bmName
                  ? `System user of ${snapshot.facebook.systemUser.bmName}`
                  : named(snapshot.facebook?.profile)}
              </Field>
              <Field label="RedTrack campaign">{named({ id: snapshot.redtrack?.campaignId, name: snapshot.redtrack?.campaignName })}</Field>
              <Field label="Website URL">{snapshot.config?.websiteUrl}</Field>
            </dl>
          </section>

          <section className={card}>
            <h2 className="text-sm font-semibold">Ad settings at launch</h2>
            <dl className={grid}>
              <Field label="Ad preset">{snapshot.adPreset?.name}</Field>
              <Field label="Call to action">{snapshot.adPreset?.callToAction || snapshot.config?.ctaOverride}</Field>
              <Field label="Display link">{snapshot.config?.displayLink}</Field>
              <Field label="Tracking parameters">{snapshot.config?.utms}</Field>
            </dl>
            <div className="mt-3 space-y-2">
              <Texts label="Primary texts" items={snapshot.adPreset?.primaryTexts} />
              <Texts label="Headlines" items={snapshot.adPreset?.headlines} />
              <Texts label="Descriptions" items={snapshot.adPreset?.descriptions} />
            </div>
          </section>

          <section className={card}>
            <h2 className="text-sm font-semibold">Creatives sent at launch</h2>
            <div className="mt-3 space-y-3">
              <Texts label="Videos" items={snapshot.media?.videos?.succeeded?.map((video) => video.name ?? '')} />
              <Texts label="Images" items={snapshot.media?.images?.succeeded?.map((image) => image.name ?? '')} />
              {failed.length > 0 && (
                <div className={alertBox}>
                  <p className="font-medium">Failed ({failed.length})</p>
                  <ul className="mt-1 space-y-0.5">
                    {failed.map((item, i) => (
                      <li key={i}>
                        {item.name}: {item.error} {item.failedAt && `(${item.failedAt})`}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Texts label="Ad IDs" items={snapshot.facebook?.adIds} />
            </div>
          </section>
        </>
      )}
    </div>
  )
}
