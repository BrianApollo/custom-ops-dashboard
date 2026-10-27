import { ChevronRight, Clapperboard, Copy, ExternalLink, Pause, Play, Plus, ShieldCheck, Trash2 } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../../auth'
import { useFetch, useRecords } from '../../data'
import { api, ApiError, text, type ApiRecord } from '../../lib/api'
import { withCred } from '../../lib/facebook'
import { button, input, StatusBadge, Tip } from '../ui'
import { ReplaceVideoDialog } from './ReplaceVideoDialog'
import { alertBox, chunks, Confirm, dollars, messageOf, title, type Confirmation, type FbAd, type FbAdSet, type FbState } from './shared'

interface Asset {
  id: string
  name: string
}

interface Props {
  record: ApiRecord
  fbCampaignId: string
  adAccountId: string
  cred: string
  productId?: string
  fb: { data?: FbState; error?: Error; reload: () => void }
  // the ad account's name as recorded at launch, shown when the token cannot list the account
  savedAdAccountName?: string
  // the page and pixel recorded at launch, shown when Facebook's own cannot be read
  savedPage?: Asset
  savedPixel?: Asset
  // our record changed (its status or budget), so the page should read it again
  onRecordChanged: () => void
  // left out when ads cannot be added, e.g. no ad account is stored on the campaign
  onAddAds?: (adSetId: string) => void
}

// POST /facebook/campaigns/ad-review: only ads that are disapproved, in review or have issues
interface ReviewAd {
  id: string
  effective_status: string
  ad_review_feedback?: { global?: Record<string, string> }
}

// Facebook will look again at these when asked; one in review is already being looked at
const CAN_REQUEST_REVIEW = ['DISAPPROVED', 'WITH_ISSUES']

const unique = (values: (string | undefined)[]) => [...new Set(values.filter((value): value is string => Boolean(value)))]

function budgetText(object: { daily_budget?: string; lifetime_budget?: string }, none: string) {
  if (Number(object.daily_budget)) return `${dollars(Number(object.daily_budget) / 100)} / day`
  if (Number(object.lifetime_budget)) return `${dollars(Number(object.lifetime_budget) / 100)} lifetime`
  return none
}

function CopyButton({ value, label }: { value: string; label: string }) {
  return (
    <Tip label={label}>
      <button aria-label={label} onClick={() => void navigator.clipboard.writeText(value)} className={`${button.icon} size-6`}>
        <Copy className="size-3.5" />
      </button>
    </Tip>
  )
}

const DAY_MS = 24 * 60 * 60 * 1000
// a pixel quiet for longer than this means purchase tracking is likely broken
const PIXEL_QUIET_DAYS = 7

const dateText = (time: string) => new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function firedText(time: string | null | undefined) {
  if (!time) return { text: 'Never fired', stale: true }
  const days = Math.floor((Date.now() - new Date(time).getTime()) / DAY_MS)
  return { text: `Last fired ${days < 1 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`}`, stale: days > PIXEL_QUIET_DAYS }
}

// An ad account, page or pixel: Facebook's current one, or the one saved at launch when the token cannot read it
function AssetTile({ label, ids, names, saved, note }: { label: string; ids: string[]; names?: Record<string, string>; saved?: Asset; note?: ReactNode }) {
  const live = ids.length > 0
  const id = live ? ids[0] : saved?.id
  const name = id ? names?.[id] || (saved?.id === id ? saved.name : '') : ''
  return (
    <div className="min-w-0 flex-1 rounded-md border border-neutral-200 px-3 py-2">
      <dt className="text-xs text-neutral-500">{label}</dt>
      <dd className="mt-0.5 flex items-center gap-2">
        {id ? (
          <>
            <span className="min-w-0 truncate font-medium">{name || 'Unnamed'}</span>
            <span className="text-xs text-neutral-500 tabular-nums">{id}</span>
            {!live && <span className="text-xs text-neutral-500">· saved at launch</span>}
            {ids.length > 1 && (
              <Tip label={ids.slice(1).join(', ')}>
                <span tabIndex={0} className="rounded bg-neutral-100 px-1.5 text-xs text-neutral-700">
                  +{ids.length - 1}
                </span>
              </Tip>
            )}
            <CopyButton value={id} label={`Copy ${label.toLowerCase()} ID`} />
          </>
        ) : (
          <span className="text-neutral-400">Not available</span>
        )}
      </dd>
      {note && <dd className="mt-0.5 text-xs">{note}</dd>}
    </div>
  )
}

// What Facebook saved on the ad set: Europe's beneficiary and payer, any regional declaration, who it targets and when it starts
function AdSetSettings({ adSet }: { adSet: FbAdSet }) {
  const targeting = adSet.targeting
  const countries = targeting?.geo_locations?.countries ?? []
  const regional = adSet.regional_regulated_categories ?? []
  const parts: ReactNode[] = [
    adSet.dsa_beneficiary ? `Beneficiary ${adSet.dsa_beneficiary}` : <span className="text-amber-700">No beneficiary</span>,
    adSet.dsa_payor ? `Payer ${adSet.dsa_payor}` : <span className="text-amber-700">No payer</span>,
  ]
  if (regional.length) parts.push(`Regional ${regional.map(title).join(', ')}`)
  if (countries.length) parts.push(countries.join(', '))
  if (targeting?.age_min || targeting?.age_max) parts.push(`Ages ${targeting?.age_min ?? 18}–${targeting?.age_max ?? 65}`)
  if (adSet.start_time) parts.push(`Starts ${dateText(adSet.start_time)}`)
  return (
    <p className="text-xs text-neutral-500">
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          {part}
        </span>
      ))}
    </p>
  )
}

function BudgetForm({ cents, disabled, onSave }: { cents: number; disabled: boolean; onSave: (cents: number) => void }) {
  const [value, setValue] = useState((cents / 100).toFixed(2))
  const next = Math.round(Number(value) * 100)
  const changed = value.trim() !== '' && Number.isFinite(next) && next > 0 && next !== cents

  function submit(event: FormEvent) {
    event.preventDefault()
    if (changed) onSave(next)
  }

  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <label htmlFor="campaign-budget" className="text-neutral-600">
        Daily budget $
      </label>
      <input
        id="campaign-budget"
        type="number"
        min="0.01"
        step="0.01"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={`${input} h-8 w-28 py-1 tabular-nums`}
      />
      <button type="submit" disabled={!changed || disabled} className={`${button.secondary} h-8`}>
        Save
      </button>
    </form>
  )
}

// Pause for something running, Resume for something paused; nothing for an archived or deleted object
function StatusButton({ status, noun, disabled, onClick }: { status: string; noun: string; disabled: boolean; onClick: () => void }) {
  if (status !== 'ACTIVE' && status !== 'PAUSED') return null
  const pause = status === 'ACTIVE'
  return (
    <button onClick={onClick} disabled={disabled} aria-label={`${pause ? 'Pause' : 'Resume'} ${noun}`} className={`${button.secondary} h-8`}>
      {pause ? <Pause className="size-4" /> : <Play className="size-4" />}
      {pause ? 'Pause' : 'Resume'}
    </button>
  )
}

// The campaign as Facebook has it now, with the controls that change it
export function LiveState({ record, fbCampaignId, adAccountId, cred, productId, fb, savedAdAccountName, savedPage, savedPixel, onRecordChanged, onAddAds }: Props) {
  const { expire } = useAuth()
  const state = fb.data
  // the id of the object being changed; one change at a time
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [confirming, setConfirming] = useState<Confirmation | null>(null)
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [replacing, setReplacing] = useState<FbAd | null>(null)
  const [review, setReview] = useState<Map<string, ReviewAd>>(new Map())

  const pageIds = unique((state?.ads ?? []).map((ad) => ad.creative?.actor_id || ad.creative?.object_story_spec?.page_id))
  const pixelIds = unique((state?.adSets ?? []).map((adSet) => adSet.promoted_object?.pixel_id))
  const namedIds = unique([...pageIds, ...pixelIds, savedPage?.id, savedPixel?.id])
  const names = useFetch<Record<string, string>>(state && namedIds.length ? withCred('/facebook/names', cred, { ids: namedIds.join(',') }) : null)
  // Facebook often refuses a pixel's name when asked by id alone, so two more sources fill
  // the gaps: the ad account's own list of pixels, and the pages and pixels synced into our tables
  const accountPixels = useFetch<{ id: string; name: string; lastFiredTime?: string | null }[]>(
    state && adAccountId && pixelIds.length ? withCred(`/facebook/ad-accounts/${encodeURIComponent(adAccountId)}/pixels`, cred) : null,
  )
  const storedPixels = useRecords('pixels', { fields: 'Pixel ID,Pixel Name' })
  const storedPages = useRecords('pages', { fields: 'Page ID,Page Name' })
  const assetNames: Record<string, string> = {}
  for (const pixel of storedPixels.records ?? []) assetNames[text(pixel, 'Pixel ID')] = text(pixel, 'Pixel Name')
  for (const page of storedPages.records ?? []) assetNames[text(page, 'Page ID')] = text(page, 'Page Name')
  // what Facebook says now wins over what was stored at the last sync
  for (const pixel of accountPixels.data ?? []) if (pixel.name) assetNames[pixel.id] = pixel.name
  for (const [id, name] of Object.entries(names.data ?? {})) if (name) assetNames[id] = name
  // an ad account's name comes from the token's own list of accounts; it is stored with or without `act_`
  const accounts = useFetch<{ adAccounts: { id: string; accountId: string; name: string }[] }>(
    state && adAccountId ? withCred('/facebook/ad-accounts', cred) : null,
  )
  const account = accounts.data?.adAccounts.find((a) => a.id === adAccountId || a.accountId === adAccountId.replace(/^act_/, ''))
  const accountName = account?.name ?? savedAdAccountName ?? ''

  // which ads Facebook has disapproved, is reviewing or has flagged; read again whenever the campaign is
  useEffect(() => {
    if (!state) return
    let stale = false
    api<{ ads: ReviewAd[] }[]>('/facebook/campaigns/ad-review', {
      method: 'POST',
      body: { cred, campaigns: [{ id: fbCampaignId, name: state.campaign.name }] },
    })
      .then((found) => !stale && setReview(new Map(found.flatMap((campaign) => campaign.ads).map((ad) => [ad.id, ad]))))
      // the badges are extra; the ads still show without them
      .catch(() => !stale && setReview(new Map()))
    return () => {
      stale = true
    }
  }, [state, cred, fbCampaignId])

  if (fb.error) {
    return (
      <p role="alert" className={alertBox}>
        Could not load this campaign from Facebook: {fb.error.message} Try another profile.
      </p>
    )
  }
  if (!state) return <p className="text-sm text-neutral-500">Loading from Facebook…</p>

  const { campaign, adSets, ads } = state
  // the daily budget is meant to be the only spend control, so any cap is flagged
  const spendCap = Number(campaign.spend_cap) || 0
  const pixel = accountPixels.data?.find((p) => p.id === pixelIds[0])
  const fired = pixel && firedText(pixel.lastFiredTime)

  // Runs one change, shows Facebook's message when it fails, and reads the campaign again either way
  async function act(key: string, work: () => Promise<string | void>) {
    setBusy(key)
    setError(undefined)
    setNotice(undefined)
    try {
      const said = await work()
      if (said) setNotice(said)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) expire()
      else setError(messageOf(err))
    } finally {
      setBusy(null)
      fb.reload()
    }
  }

  const patch = (path: string, body: Record<string, unknown>) => api(path, { method: 'PATCH', body })

  function toggleCampaign() {
    const pause = campaign.status === 'ACTIVE'
    setConfirming({
      title: pause ? 'Pause this campaign?' : 'Resume this campaign?',
      body: pause
        ? `“${campaign.name}” stops delivering and spending on Facebook, and is marked Cancelled here.`
        : `“${campaign.name}” starts delivering and spending again on Facebook, and is marked Launched here.`,
      action: pause ? 'Pause campaign' : 'Resume campaign',
      run: () =>
        void act(campaign.id, async () => {
          await patch(`/facebook/campaigns/${campaign.id}`, { cred, status: pause ? 'PAUSED' : 'ACTIVE' })
          try {
            await patch(`/data/campaigns/${record.id}`, { fields: { Status: pause ? 'Cancelled' : 'Launched' } })
          } catch (err) {
            if (err instanceof ApiError && err.status === 401) throw err
            throw new Error(`Facebook has the campaign ${pause ? 'paused' : 'active'} now, but its status here could not be updated: ${messageOf(err)}`)
          } finally {
            onRecordChanged()
          }
        }),
    })
  }

  function saveBudget(cents: number) {
    setConfirming({
      title: 'Change the daily budget?',
      body: `“${campaign.name}” goes from ${dollars(Number(campaign.daily_budget) / 100)} to ${dollars(cents / 100)} a day on Facebook, effective at once. The budget stored on this campaign here is updated to match.`,
      action: 'Change budget',
      run: () =>
        void act(campaign.id, async () => {
          await patch(`/facebook/campaigns/${campaign.id}`, { cred, dailyBudgetCents: cents })
          try {
            await patch(`/data/campaigns/${record.id}`, { fields: { Budget: cents / 100 } })
          } catch (err) {
            if (err instanceof ApiError && err.status === 401) throw err
            throw new Error(`Facebook has the new budget, but the budget stored here could not be updated: ${messageOf(err)}`)
          } finally {
            onRecordChanged()
          }
        }),
    })
  }

  // An ad set or an ad. Only the campaign's own switch changes our record's status.
  function toggle(kind: 'adsets' | 'ads', target: { id: string; name: string; status: string }) {
    const pause = target.status === 'ACTIVE'
    const noun = kind === 'ads' ? 'ad' : 'ad set'
    setConfirming({
      title: `${pause ? 'Pause' : 'Resume'} this ${noun}?`,
      body: pause ? `“${target.name}” stops delivering.` : `“${target.name}” starts delivering again, if the campaign${kind === 'ads' ? ' and its ad set are' : ' is'} active.`,
      action: `${pause ? 'Pause' : 'Resume'} ${noun}`,
      run: () => void act(target.id, () => patch(`/facebook/${kind}/${target.id}`, { cred, status: pause ? 'PAUSED' : 'ACTIVE' }).then(() => undefined)),
    })
  }

  function remove(ad: FbAd) {
    setConfirming({
      title: 'Delete this ad?',
      body: `“${ad.name}” is deleted on Facebook and stops delivering. This cannot be undone.`,
      action: 'Delete ad',
      danger: true,
      run: () => void act(ad.id, () => api(withCred(`/facebook/ads/${ad.id}`, cred), { method: 'DELETE' }).then(() => undefined)),
    })
  }

  function requestReview(targets: FbAd[]) {
    void act('review', async () => {
      const results: { adId: string; adName: string | null; success: boolean; error: string | null }[] = []
      // the API takes 200 ads a request
      for (const group of chunks(targets, 200)) {
        results.push(
          ...(await api<typeof results>('/facebook/ads/request-review', {
            method: 'POST',
            body: { cred, ads: group.map((ad) => ({ id: ad.id, name: ad.name })) },
          })),
        )
      }
      const refused = results.filter((result) => !result.success)
      if (refused.length) {
        throw new Error(
          `Facebook refused ${refused.length} of ${results.length} review requests. ${refused.map((result) => `${result.adName ?? result.adId}: ${result.error}`).join('; ')}`,
        )
      }
      return results.length === 1 ? 'Facebook was asked to review the ad again.' : `Facebook was asked to review ${results.length} ads again.`
    })
  }

  const reviewable = ads.filter((ad) => CAN_REQUEST_REVIEW.includes(review.get(ad.id)?.effective_status ?? ''))
  const activeAds = ads.filter((ad) => ad.status === 'ACTIVE').length
  const pausedAds = ads.filter((ad) => ad.status === 'PAUSED').length
  const working = busy !== null

  const iconAction = (label: string, icon: ReactNode, onClick: () => void, disabled = false) => (
    <Tip label={label}>
      {/* a disabled button fires no pointer events, so the span carries the tooltip */}
      <span tabIndex={disabled ? 0 : undefined}>
        <button aria-label={label} onClick={onClick} disabled={working || disabled} className={button.icon}>
          {icon}
        </button>
      </span>
    </Tip>
  )

  function adCard(ad: FbAd) {
    const flagged = review.get(ad.id)
    const reasons = Object.keys(flagged?.ad_review_feedback?.global ?? {})
    return (
      <li key={ad.id} className={`flex flex-col overflow-hidden rounded-md border border-neutral-200 bg-white ${busy === ad.id ? 'opacity-60' : ''}`}>
        <div className="flex aspect-video items-center justify-center bg-neutral-100 text-xs text-neutral-400">
          {ad.creative?.thumbnail_url ? <img src={ad.creative.thumbnail_url} alt="" loading="lazy" className="size-full object-cover" /> : 'No preview'}
        </div>
        <div className="flex flex-1 flex-col gap-1.5 px-3 py-2">
          <p className="truncate text-sm font-medium" title={ad.name}>
            {ad.name}
          </p>
          <p className="text-xs text-neutral-500 tabular-nums">{ad.id}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={title(ad.status)} />
            {flagged && <StatusBadge status={title(flagged.effective_status)} />}
          </div>
          {reasons.length > 0 && <p className="text-xs text-red-700">{reasons.join(', ')}</p>}
          <div className="mt-auto -mx-1.5 flex items-center pt-1">
            {(ad.status === 'ACTIVE' || ad.status === 'PAUSED') &&
              iconAction(
                ad.status === 'ACTIVE' ? 'Pause ad' : 'Resume ad',
                ad.status === 'ACTIVE' ? <Pause className="size-4" /> : <Play className="size-4" />,
                () => toggle('ads', ad),
              )}
            {iconAction(
              !adAccountId
                ? 'Replace video (no ad account is stored on this campaign)'
                : ad.creative?.id
                  ? 'Replace video'
                  : 'Replace video (this ad has no creative to copy)',
              <Clapperboard className="size-4" />,
              () => setReplacing(ad),
              !ad.creative?.id || !adAccountId,
            )}
            {flagged && CAN_REQUEST_REVIEW.includes(flagged.effective_status) && iconAction('Request review', <ShieldCheck className="size-4" />, () => requestReview([ad]))}
            <Tip label="Preview on Facebook">
              <a
                href={`https://www.facebook.com/ads/manager/creative_hub/preview/?ad_id=${ad.id}`}
                target="_blank"
                rel="noreferrer"
                aria-label="Preview on Facebook"
                className={button.icon}
              >
                <ExternalLink className="size-4" />
              </a>
            </Tip>
            <span className="ml-auto">{iconAction('Delete ad', <Trash2 className="size-4" />, () => remove(ad))}</span>
          </div>
        </div>
      </li>
    )
  }

  function adSetCard(adSet: FbAdSet) {
    const own = ads.filter((ad) => ad.adset_id === adSet.id)
    const open = !closed.has(adSet.id)
    return (
      <section key={adSet.id} className="rounded-lg border border-neutral-200 bg-white">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
          <button
            aria-expanded={open}
            aria-label={open ? 'Hide ads' : 'Show ads'}
            onClick={() => {
              const next = new Set(closed)
              if (open) next.add(adSet.id)
              else next.delete(adSet.id)
              setClosed(next)
            }}
            className={button.icon}
          >
            <ChevronRight className={`size-4 ${open ? 'rotate-90' : ''}`} />
          </button>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-semibold" title={adSet.name}>
              {adSet.name}
            </h3>
            <p className="text-xs text-neutral-500">
              Ad set <span className="tabular-nums">{adSet.id}</span> · {own.length} {own.length === 1 ? 'ad' : 'ads'} ·{' '}
              {own.filter((ad) => ad.status === 'ACTIVE').length} active · {budgetText(adSet, 'budget set on the campaign')}
            </p>
            <AdSetSettings adSet={adSet} />
          </div>
          <StatusBadge status={title(adSet.status)} />
          <StatusButton status={adSet.status} noun="ad set" disabled={working} onClick={() => toggle('adsets', adSet)} />
          <button onClick={() => onAddAds?.(adSet.id)} disabled={working || !onAddAds} className={`${button.secondary} h-8`}>
            <Plus className="size-4" />
            Add ads
          </button>
        </div>
        {open && (
          <div className="border-t border-neutral-200 bg-neutral-50 p-4">
            {own.length ? (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">{own.map(adCard)}</ul>
            ) : (
              <p className="py-4 text-center text-sm text-neutral-500">This ad set has no ads.</p>
            )}
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className={alertBox}>
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {notice}
        </p>
      )}

      <section className={`rounded-lg border border-l-4 border-neutral-200 bg-white p-4 text-sm ${campaign.status === 'ACTIVE' ? 'border-l-emerald-600' : 'border-l-neutral-400'}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold" title={campaign.name}>
              {campaign.name}
            </h2>
            <p className="text-xs text-neutral-500">
              {adSets.length} {adSets.length === 1 ? 'ad set' : 'ad sets'} · {ads.length} {ads.length === 1 ? 'ad' : 'ads'} · {activeAds} active ·{' '}
              {pausedAds} paused{campaign.objective ? ` · ${title(campaign.objective)}` : ''}
              {campaign.bid_strategy ? ` · ${title(campaign.bid_strategy)}` : ''} ·{' '}
              {spendCap ? <span className="font-medium text-amber-700">Spend cap {dollars(spendCap / 100)}</span> : 'No spend cap'}
            </p>
          </div>
          {Number(campaign.daily_budget) ? (
            // a fresh form whenever Facebook's figure changes
            <BudgetForm key={campaign.daily_budget} cents={Number(campaign.daily_budget)} disabled={working} onSave={saveBudget} />
          ) : (
            <span className="text-neutral-600">{budgetText(campaign, 'Budget set on the ad sets')}</span>
          )}
          <StatusBadge status={title(campaign.status)} />
          <StatusButton status={campaign.status} noun="campaign" disabled={working} onClick={toggleCampaign} />
        </div>
        <dl className="mt-3 flex flex-wrap gap-3">
          <AssetTile label="Ad account" ids={adAccountId ? [adAccountId] : []} names={{ [adAccountId]: accountName }} />
          <AssetTile label="Facebook page" ids={pageIds} names={assetNames} saved={savedPage} />
          <AssetTile
            label="Pixel"
            ids={pixelIds}
            names={assetNames}
            saved={savedPixel}
            note={
              fired && (
                <span className={fired.stale ? 'text-amber-700' : 'text-neutral-500'} title={pixel?.lastFiredTime ? dateText(pixel.lastFiredTime) : undefined}>
                  {fired.text}
                </span>
              )
            }
          />
        </dl>
        {reviewable.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-amber-50 px-3 py-2 text-amber-900">
            <span className="flex-1">
              {reviewable.length === 1 ? 'One ad is' : `${reviewable.length} ads are`} disapproved or flagged with issues.
            </span>
            <button onClick={() => requestReview(reviewable)} disabled={working} className={`${button.secondary} h-8`}>
              <ShieldCheck className="size-4" />
              {busy === 'review' ? 'Requesting…' : reviewable.length === 1 ? 'Request review' : `Request review for all ${reviewable.length}`}
            </button>
          </div>
        )}
      </section>

      {adSets.map(adSetCard)}
      {adSets.length === 0 && <p className="rounded-lg border border-dashed border-neutral-300 px-4 py-8 text-center text-sm text-neutral-500">Facebook shows no ad sets in this campaign.</p>}

      <Confirm confirmation={confirming} onClose={() => setConfirming(null)} />
      {replacing && (
        <ReplaceVideoDialog
          ad={replacing}
          adAccountId={adAccountId}
          cred={cred}
          productId={productId}
          onClose={() => setReplacing(null)}
          onChanged={fb.reload}
        />
      )}
    </div>
  )
}
