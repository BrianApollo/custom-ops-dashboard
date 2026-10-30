import { ArrowLeft, ChevronDown, CircleAlert, CircleCheck, Copy, RefreshCw, Save, TriangleAlert, X } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useAuth } from '../../auth'
import { button, Select, StatusBadge, Tip } from '../../components/ui'
import { useAllPages, useFetch, useRecords, useWorkspace } from '../../data'
import { api, text, type ApiRecord } from '../../lib/api'
import { ChecklistPanel } from './ChecklistPanel'
import { CloneDialog, launchedOn } from './CloneDialog'
import {
  CALLS_TO_ACTION,
  campaignFields,
  checklist,
  countriesFrom,
  credOf,
  draftFrom,
  facebookCta,
  mediaFields,
  presetTexts,
  variations,
  WHOLE_UNIT_CURRENCIES,
  zonedSeconds,
  type Creative,
  type Draft,
  type TokenType,
} from './draft'
import { findAsset, useAssets } from './facebook'
import { dismissLaunch, startLaunch, useLaunchRun, type LaunchPlan } from './launch'
import { LaunchConfirm } from './LaunchConfirm'
import { LaunchProgress } from './LaunchProgress'
import { MediaPanel } from './MediaPanel'
import { SettingsPanel } from './SettingsPanel'
import { useAutosave, type SaveState } from './useAutosave'

interface VideoRow {
  id: string
  name: string | null
  status: string | null
  format: string | null
  creativeLink: string | null
}

interface ImageRow {
  id: string
  name: string | null
  status: string
  url: string | null
}

// The parts of an earlier launch's snapshot that cloning falls back on
interface Snapshot {
  config?: { budget?: number; geo?: string[]; startTime?: string; websiteUrl?: string; utms?: string; displayLink?: string; ctaOverride?: string }
  facebook?: {
    adAccount?: { id?: string }
    page?: { id?: string }
    pixel?: { id?: string }
    profile?: { id?: string }
    systemUser?: { bmRecordId?: string }
  }
  adPreset?: { id?: string }
  redtrack?: { campaignId?: string; campaignName?: string }
  media?: Record<'videos' | 'images', { succeeded?: { localId?: string; name?: string }[] } | undefined>
}

function snapshotOf(record: ApiRecord): Snapshot {
  try {
    return (JSON.parse(text(record, 'Launched Data')) as Snapshot | null) ?? {}
  } catch {
    return {}
  }
}

const TOKEN_TYPES: { value: TokenType; label: string }[] = [
  { value: 'profile', label: 'Profile token' },
  { value: 'bm', label: 'System user token' },
]

function SaveIndicator({ state, error, onRetry }: { state: SaveState; error?: string; onRetry: () => void }) {
  if (state === 'idle') return null
  if (state === 'error') {
    return (
      <span role="alert" className="flex items-center gap-1.5 text-sm font-medium text-red-700">
        <CircleAlert className="size-4" />
        <Tip label={error ?? 'The campaign record was not updated'}>
          <span tabIndex={0}>Could not save</span>
        </Tip>
        <button type="button" onClick={onRetry} className="underline">
          Retry
        </button>
      </span>
    )
  }
  return (
    <span role="status" className={`flex items-center gap-1.5 text-sm ${state === 'saved' ? 'text-emerald-700' : 'text-neutral-600'}`}>
      {state === 'saved' ? <CircleCheck className="size-4" /> : <RefreshCw className="size-4 animate-spin" />}
      {state === 'saved' ? 'Saved' : 'Saving…'}
    </span>
  )
}

function Launcher({ campaign, onReload }: { campaign: ApiRecord; onReload: () => void }) {
  const { products } = useWorkspace()
  const productId = (campaign.fields.Product as string[] | undefined)?.[0]
  const product = products.find((p) => p.id === productId)
  const [draft, setDraft] = useState<Draft>(() => draftFrom(campaign))
  // goes up with every edit; the autosave follows it
  const [version, setVersion] = useState(0)
  const [notice, setNotice] = useState<{ text: string; bad?: boolean }>()
  const [dialog, setDialog] = useState<'clone' | 'confirm'>()
  const [savingTemplate, setSavingTemplate] = useState(false)
  const run = useLaunchRun(campaign.id)
  const status = text(campaign, 'Status')
  // the launcher is for campaigns that have not gone out
  const locked = status === 'Launched' || status === 'Cancelled'

  // the launcher needs the whole list to tick from, however many pages it takes. Only the
  // campaign's own product is offered; a campaign with no product is offered no media at all.
  const byProduct = productId ? new URLSearchParams({ productId }) : null
  const videos = useAllPages<VideoRow>(byProduct && `/videos?${byProduct}`)
  const aiVideos = useAllPages<VideoRow>(byProduct && `/videos?kind=ai&${byProduct}`)
  const images = useAllPages<ImageRow>(byProduct && `/images?${byProduct}`)
  // newest first; '' matches no product, so a campaign without one is offered none
  const presets = useRecords('ad_presets', { sort: '-createdTime', 'where[Product]': productId ?? '' })
  const profiles = useRecords('profiles', { fields: 'Profile Name,Profile ID,Hidden,hasToken' })
  const managers = useRecords('business_managers', { fields: 'BM Name,BM ID,Hidden,System User ID,hasToken' })
  // '' matches no product, so a campaign without one is offered nothing
  const templates = useRecords('campaign_launch_setup', { 'where[Product]': productId ?? '' })
  const siblings = useRecords('campaigns', { 'where[Product]': productId ?? '' })

  const video = (kind: 'video' | 'ai') => (row: VideoRow): Creative => ({
    id: row.id,
    name: row.name ?? 'Untitled',
    status: row.status ?? '',
    kind,
    url: row.creativeLink ?? '',
  })
  // A YouTube cut is not an ad, and a video still To Do has no file yet, so neither is offered.
  // A To Do video already ticked in this draft stays listed, so it can be unticked.
  const offered = (row: VideoRow) => row.status !== 'To Do' || draft.videoIds.has(row.id)
  // highest number first: `Script 1052` before `Script 1011`, and `Script 100` after both
  const byNumberDescending = (a: Creative, b: Creative) => b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' })
  // AI videos sit in their own table and join the same list
  const allVideos = !productId
    ? []
    : videos.data && aiVideos.data
      ? [
          ...videos.data.records.filter(offered).map(video('video')),
          ...aiVideos.data.records.filter(offered).map(video('ai')),
        ].sort(byNumberDescending)
      : undefined
  // a generated image is not in the Images table until it is approved
  const usableImages = !productId
    ? []
    : images.data?.records
        .filter((image) => image.status !== 'New')
        .map((image): Creative => ({ id: image.id, name: image.name ?? 'Untitled', status: image.status, kind: 'image', url: image.url ?? '' }))
        .sort(byNumberDescending)
  const chosenVideos = (allVideos ?? []).filter((item) => draft.videoIds.has(item.id))
  const chosenImages = (usableImages ?? []).filter((image) => draft.imageIds.has(image.id))
  const chosen = [...chosenVideos, ...chosenImages]
  const preset = presets.records?.find((record) => record.id === draft.presetId)

  const cred = credOf(draft)
  const assets = useAssets(cred, draft.adAccountId)
  const account = findAsset(assets.accounts.items, draft.adAccountId)
  const groups = checklist(draft, preset, chosen, account)

  // the media links are saved only once both lists are in, because they say which chosen video is an AI video;
  // with no product there are no lists, and the links already saved are left as they are
  const fields = {
    ...campaignFields(draft),
    ...(productId && allVideos && usableImages ? mediaFields(draft, [...allVideos, ...usableImages]) : {}),
  }
  const autosave = useAutosave(campaign.id, fields, version, Boolean(run) || locked)

  function change(changes: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...changes }))
    setVersion((v) => v + 1)
  }

  const profile = profiles.records?.find((record) => record.id === draft.profileId)
  const manager = managers.records?.find((record) => record.id === draft.bmId)
  const profileOptions = (profiles.records ?? [])
    .filter((record) => !record.fields.Hidden || record.id === draft.profileId)
    .map((record) => ({ value: record.id, label: text(record, 'Profile Name') || text(record, 'Profile ID') || record.id }))
  // only a business manager with a system user token can launch
  const managerOptions = (managers.records ?? [])
    .filter((record) => (!record.fields.Hidden && record.fields.hasToken) || record.id === draft.bmId)
    .map((record) => ({ value: record.id, label: text(record, 'BM Name') || `BM ${text(record, 'BM ID') || record.id}` }))
    .sort((a, b) => a.label.localeCompare(b.label))
  const owners = draft.tokenType === 'bm' ? { list: managers, options: managerOptions, value: draft.bmId } : { list: profiles, options: profileOptions, value: draft.profileId }
  // a choice saved on the campaign stays visible when its record is hidden or gone
  if (owners.value && !owners.options.some((option) => option.value === owners.value)) {
    owners.options.unshift({ value: owners.value, label: owners.value })
  }
  const owner = draft.tokenType === 'bm' ? manager : profile
  const noToken = owner && !owner.fields.hasToken

  // The product's template: its first launch setup record. It only ever fills empty fields.
  const template = productId ? templates.records?.[0] : undefined
  // a field is offered the template once per visit, so clearing one to retype it does not bring the value back
  const settled = useRef(new Set<string>())

  function applyTemplate(manual: boolean) {
    if (!template) return
    const changes: Partial<Draft> = {}
    const filled: string[] = []
    const consider = (key: string, ready: boolean, fill: () => void) => {
      if (!ready || (!manual && settled.current.has(key))) return
      settled.current.add(key)
      fill()
    }
    consider('budget', true, () => {
      const amount = text(template, 'Amount')
      if (!draft.budget.trim() && amount) {
        changes.budget = amount
        filled.push('budget')
      }
    })
    consider('countries', true, () => {
      const countries = countriesFrom(text(template, 'Targeting'))
      if (!draft.countries.length && countries.length) {
        changes.countries = countries
        filled.push('countries')
      }
    })
    consider('cta', true, () => {
      const wanted = text(template, 'Call to Action')
      const label = CALLS_TO_ACTION.find((cta) => facebookCta(cta) === facebookCta(wanted)) ?? wanted
      // The call to action is never empty, so it counts as empty while it is the default.
      // On its own the template fills it only for a campaign that has never had one saved,
      // or a deliberate `Learn More` would be replaced on every visit.
      const untouched = draft.callToAction === CALLS_TO_ACTION[0] && (manual || !text(campaign, 'CTA'))
      if (label && untouched && label !== draft.callToAction) {
        changes.callToAction = label
        filled.push('call to action')
      }
    })
    consider('account', Boolean(assets.accounts.items), () => {
      const match = findAsset(assets.accounts.items, text(template, 'Ad Account'))
      if (!draft.adAccountId && match) {
        changes.adAccountId = match.id
        filled.push('ad account')
      }
    })
    consider('page', Boolean(assets.pages.items), () => {
      const match = findAsset(assets.pages.items, text(template, 'Page'))
      if (!draft.pageId && match) {
        changes.pageId = match.id
        filled.push('page')
      }
    })
    // pixels are listed per ad account, so this waits for the account
    consider('pixel', Boolean(draft.adAccountId && assets.pixels.items), () => {
      const match = findAsset(assets.pixels.items, text(template, 'Pixel'))
      if (!draft.pixelId && match) {
        changes.pixelId = match.id
        filled.push('pixel')
      }
    })
    if (filled.length) {
      change(changes)
      setNotice({ text: `Filled from the product's template: ${filled.join(', ')}.` })
    } else if (manual) {
      setNotice({
        text: 'The template had nothing to add. Every field it covers is already filled, or its ad account, page or pixel is not one this token reaches.',
      })
    }
  }

  useEffect(() => {
    if (!run && !locked) applyTemplate(false)
    // runs as the template and each Facebook list arrive; the draft is read as it is at that moment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, assets.accounts.items, assets.pages.items, assets.pixels.items, draft.adAccountId])

  // Updates the product's template when it has one, so the template that is applied is the one last saved
  async function saveTemplate() {
    if (!productId) return
    setSavingTemplate(true)
    const values: Record<string, string> = {
      'Ad Account': draft.adAccountId,
      Pixel: draft.pixelId,
      Page: draft.pageId,
      Amount: draft.budget.trim(),
      'Call to Action': draft.callToAction,
      Targeting: draft.countries.join(','),
    }
    // an empty field here does not wipe what the template already holds
    const filled = Object.fromEntries(Object.entries(values).filter(([, value]) => value))
    try {
      if (template) {
        await api(`/data/campaign_launch_setup/${template.id}`, { method: 'PATCH', body: { fields: filled } })
      } else {
        await api('/data/campaign_launch_setup', {
          method: 'POST',
          body: { fields: { ...filled, Product: [productId], Name: `${product?.name ?? 'Product'} Default 1`, Count: 1 } },
        })
      }
      templates.reload()
      setNotice({ text: `Template ${template ? 'updated' : 'saved'} for ${product?.name ?? 'this product'}: ${Object.keys(filled).join(', ').toLowerCase()}.` })
    } catch (err) {
      setNotice({ text: `Could not save the template: ${(err as Error).message}`, bad: true })
    }
    setSavingTemplate(false)
  }

  // Launched campaigns of the same product, newest first
  const candidates = siblings.records
    ?.filter((record) => record.id !== campaign.id && text(record, 'FB Campaign ID').trim() && text(record, 'Status') !== 'Preparing')
    .sort((a, b) => launchedOn(b).localeCompare(launchedOn(a)) || b.createdTime.localeCompare(a.createdTime))

  // Copies an earlier campaign's setup and creatives. What it saved as a draft wins; its launch snapshot fills the gaps.
  function clone(source: ApiRecord) {
    const from = draftFrom(source)
    const snap = snapshotOf(source)
    const fb = snap.facebook
    const time = (text(source, 'Launch Time') || snap.config?.startTime || '').slice(0, 5)
    const geo = from.countries.length ? from.countries : countriesFrom((snap.config?.geo ?? []).join(','))

    const succeeded = (kind: 'videos' | 'images') => snap.media?.[kind]?.succeeded ?? []
    const ids = new Set([...from.videoIds, ...from.imageIds, ...[...succeeded('videos'), ...succeeded('images')].flatMap((item) => item.localId ?? [])])
    const named = (kind: 'videos' | 'images') => new Set(succeeded(kind).flatMap((item) => item.name ?? []))
    // by id, or by name for a creative that was made again since
    const matches = (pool: Creative[] | undefined, names: Set<string>) => (pool ?? []).filter((item) => ids.has(item.id) || names.has(item.name))
    const mediaReady = Boolean(allVideos && usableImages)
    const clonedVideos = matches(allVideos, named('videos'))
    const clonedImages = matches(usableImages, named('images'))
    const gone = [...ids].filter((id) => ![...clonedVideos, ...clonedImages].some((item) => item.id === id)).length

    change({
      tokenType: fb?.systemUser?.bmRecordId && !from.profileId ? 'bm' : from.tokenType,
      profileId: from.profileId || text(source, 'Launch Profile ID') || fb?.profile?.id || draft.profileId,
      bmId: from.bmId || fb?.systemUser?.bmRecordId || draft.bmId,
      redtrackId: from.redtrackId || snap.redtrack?.campaignId || '',
      redtrackName: from.redtrackName || snap.redtrack?.campaignName || '',
      presetId: from.presetId || snap.adPreset?.id || draft.presetId,
      presetTexts: null,
      linkVariable: from.linkVariable,
      adAccountId: from.adAccountId || text(source, 'FB Ad Account ID') || fb?.adAccount?.id || '',
      pageId: from.pageId || fb?.page?.id || '',
      pixelId: from.pixelId || fb?.pixel?.id || '',
      // the time of day is copied; the date stays this campaign's own
      start: draft.start && /^\d{2}:\d{2}$/.test(time) ? `${draft.start.split('T')[0]}T${time}` : draft.start,
      budget: from.budget || (snap.config?.budget ? String(snap.config.budget) : draft.budget),
      countries: geo.length ? geo : draft.countries,
      callToAction: text(source, 'CTA') || snap.config?.ctaOverride || draft.callToAction,
      websiteUrl: from.websiteUrl || snap.config?.websiteUrl || '',
      tracking: from.tracking || snap.config?.utms || '',
      displayLink: from.displayLink || snap.config?.displayLink || '',
      ...(mediaReady ? { videoIds: new Set(clonedVideos.map((item) => item.id)), imageIds: new Set(clonedImages.map((item) => item.id)) } : {}),
    })
    // the fields are now filled on purpose; the template has nothing to add to them
    for (const key of ['budget', 'countries', 'cta', 'account', 'page', 'pixel']) settled.current.add(key)
    setDialog(undefined)
    setNotice({
      text: mediaReady
        ? `Cloned “${text(source, 'Name')}”: ${clonedVideos.length} videos and ${clonedImages.length} images selected.${
            gone ? ` ${gone} of its creatives ${gone === 1 ? 'is' : 'are'} no longer available for this product.` : ''
          }`
        : `Cloned “${text(source, 'Name')}”. Its creatives were not selected because the media list had not loaded; clone again once it has.`,
    })
  }

  // Everything the launch needs, fixed at the moment the confirmation opens
  function plan(): { plan: LaunchPlan; blockers: string[] } | undefined {
    if (!account) return undefined
    const texts = presetTexts(draft, preset)
    const budget = Number(draft.budget)
    const startTime = zonedSeconds(draft.start, account.timezoneName)
    const currency = account.currency ?? ''
    const blockers: string[] = []
    if (startTime === null) {
      blockers.push(
        `The start time could not be worked out in the ad account's time zone (${account.timezoneName ?? 'Facebook did not say which'}), so the launch cannot go ahead.`,
      )
    }
    if (WHOLE_UNIT_CURRENCIES.includes(currency)) {
      blockers.push(`This ad account is in ${currency}, which Facebook counts in whole units. The launcher would send a budget a hundred times too large, so it does not launch in this currency.`)
    }
    const named = (items: { id: string; name: string }[] | undefined, id: string) => ({ id, name: items?.find((item) => item.id === id)?.name ?? id })
    return {
      blockers,
      plan: {
        campaignId: campaign.id,
        cred,
        token:
          draft.tokenType === 'bm'
            ? {
                kind: 'bm',
                recordId: draft.bmId,
                name: manager ? text(manager, 'BM Name') || `BM ${text(manager, 'BM ID')}` : draft.bmId,
                bmId: manager ? text(manager, 'BM ID') : undefined,
                systemUserId: manager ? text(manager, 'System User ID') : undefined,
              }
            : { kind: 'profile', recordId: draft.profileId, name: profile ? text(profile, 'Profile Name') || draft.profileId : draft.profileId },
        adAccount: { id: account.id, name: account.name, timezoneName: account.timezoneName ?? '', currency },
        page: named(assets.pages.items, draft.pageId),
        pixel: named(assets.pixels.items, draft.pixelId),
        name: draft.name.trim(),
        budget,
        budgetCents: Math.round(budget * 100),
        countries: draft.countries,
        start: draft.start,
        startTime: startTime ?? 0,
        status: draft.launchActive ? 'ACTIVE' : 'PAUSED',
        websiteUrl: draft.websiteUrl.trim(),
        urlTags: draft.tracking.trim(),
        displayLink: draft.displayLink.trim(),
        ctaLabel: draft.callToAction,
        callToAction: facebookCta(draft.callToAction),
        bodies: variations(texts, 'Primary Text'),
        titles: variations(texts, 'Headline'),
        descriptions: variations(texts, 'Description'),
        // the names Europe's ad rules ask for come from the preset
        beneficiaryName: preset ? text(preset, 'Beneficiary Name') || undefined : undefined,
        payerName: preset ? text(preset, 'Payer Name') || undefined : undefined,
        preset: { id: draft.presetId, name: preset ? text(preset, 'Preset Name') : '' },
        redtrack: draft.redtrackId ? { id: draft.redtrackId, name: draft.redtrackName } : undefined,
        reuse: draft.reuseCreatives,
        media: chosen.map(({ id, name, kind, url }) => ({ id, name, kind, url })),
      },
    }
  }

  const campaignsPath = productId ? `/products?product=${productId}` : '/products'

  if (run) {
    return (
      <LaunchProgress
        run={run}
        campaignsPath={campaignsPath}
        onBack={() => {
          dismissLaunch(campaign.id)
          // the record now carries what the attempt created
          onReload()
        }}
      />
    )
  }

  if (locked) {
    return (
      <div className="max-w-xl space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">{text(campaign, 'Name') || 'Campaign'}</h1>
        <p className="text-sm text-neutral-700">
          This campaign has already been launched{text(campaign, 'FB Campaign ID') ? ` as Facebook campaign ${text(campaign, 'FB Campaign ID')}` : ''}. Launching
          it again would create a second campaign on Facebook, so the launcher is closed for it.
        </p>
        <div className="flex gap-2">
          <Link to={`/campaigns/${campaign.id}`} className={button.primary}>
            View campaign
          </Link>
          <Link to={campaignsPath} className={button.secondary}>
            Back to campaigns
          </Link>
        </div>
      </div>
    )
  }

  const existing = text(campaign, 'FB Campaign ID')
  const confirming = dialog === 'confirm' ? plan() : undefined

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Tip label="Back to campaigns">
          <Link to={campaignsPath} aria-label="Back to campaigns" className={button.icon}>
            <ArrowLeft className="size-4" />
          </Link>
        </Tip>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">Campaign launcher</h1>
          <p className="flex items-center gap-2 text-sm text-neutral-600">
            {product?.name ?? 'No product'}
            <StatusBadge status={status} />
          </p>
        </div>
        <SaveIndicator state={autosave.state} error={autosave.error} onRetry={() => void autosave.save()} />
        <button type="button" onClick={() => setDialog('clone')} className={button.secondary}>
          <Copy className="size-4" />
          Clone campaign{candidates?.length ? ` (${candidates.length})` : ''}
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger disabled={!productId || savingTemplate} className={button.secondary}>
            <Save className="size-4" />
            {savingTemplate ? 'Saving…' : 'Template'}
            <ChevronDown className="size-4 text-neutral-500" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content align="end" sideOffset={4} className="z-50 max-w-80 rounded-md border border-neutral-200 bg-white p-1 text-sm shadow-lg">
              <DropdownMenu.Item
                onSelect={() => void saveTemplate()}
                className="cursor-default rounded px-2 py-1.5 outline-none data-highlighted:bg-neutral-100"
              >
                Save as template
                <span className="block text-xs text-neutral-500">
                  {template ? 'Replaces' : 'Sets'} this product's ad account, page, pixel, budget, countries and call to action
                </span>
              </DropdownMenu.Item>
              <DropdownMenu.Item
                disabled={!template}
                onSelect={() => applyTemplate(true)}
                className="cursor-default rounded px-2 py-1.5 outline-none data-disabled:text-neutral-400 data-highlighted:bg-neutral-100"
              >
                Apply template to empty fields
                <span className="block text-xs text-neutral-500">
                  {template ? 'Nothing already filled is changed' : templates.error ? 'The template could not be loaded' : 'This product has no template yet'}
                </span>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <div className="flex items-center gap-2 text-sm text-neutral-600">
          <Select
            label="Whose Facebook token to use"
            value={draft.tokenType}
            options={TOKEN_TYPES}
            // ad accounts, pages and pixels belong to the token, so another token clears them
            onValueChange={(tokenType) => tokenType !== draft.tokenType && change({ tokenType: tokenType as TokenType, adAccountId: '', pageId: '', pixelId: '' })}
            className="h-9.5 w-44"
          />
          <Select
            label={draft.tokenType === 'bm' ? 'Business manager' : 'Profile'}
            value={owners.value}
            options={owners.options}
            placeholder={
              owners.list.error
                ? 'Could not load'
                : !owners.list.records
                  ? 'Loading…'
                  : owners.options.length
                    ? draft.tokenType === 'bm'
                      ? 'Select a business manager'
                      : 'Select a profile'
                    : draft.tokenType === 'bm'
                      ? 'No business manager has a system user token'
                      : 'No profiles'
            }
            disabled={owners.options.length === 0}
            onValueChange={(id) => change({ ...(draft.tokenType === 'bm' ? { bmId: id } : { profileId: id }), adAccountId: '', pageId: '', pixelId: '' })}
            className="h-9.5 w-52"
          />
        </div>
      </div>

      {noToken && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {draft.tokenType === 'bm' ? 'This business manager has no system user token stored.' : 'This profile has no Facebook token stored.'} Choose another, or
          add the token in Infrastructure.
        </p>
      )}
      {existing && (
        <p className="mt-3 flex gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-900">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            An earlier launch attempt created Facebook campaign {existing}
            {text(campaign, 'FB Ad Account ID') ? ` in ${text(campaign, 'FB Ad Account ID')}` : ''}, without ads. Launching again creates a new campaign beside it;
            delete or pause the earlier one in Ads Manager if it should not run.
          </span>
        </p>
      )}
      {notice && (
        <p role="status" className={`mt-3 flex items-start gap-2 rounded-md p-3 text-sm ${notice.bad ? 'bg-red-50 text-red-800' : 'bg-blue-50 text-blue-900'}`}>
          <span className="min-w-0 flex-1">{notice.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(undefined)} className="rounded p-0.5 hover:bg-black/5">
            <X className="size-4" />
          </button>
        </p>
      )}

      <div className="mt-6 grid items-start gap-5 xl:grid-cols-[22rem_minmax(0,1fr)_19rem] 2xl:grid-cols-[minmax(26rem,1fr)_minmax(0,1.3fr)_22rem]">
        <MediaPanel
          draft={draft}
          onChange={change}
          videos={allVideos}
          images={usableImages}
          error={(videos.error ?? aiVideos.error ?? images.error)?.message}
          cred={cred}
        />
        <SettingsPanel draft={draft} onChange={change} presets={presets.records} assets={assets} account={account} />
        <ChecklistPanel
          draft={draft}
          onChange={change}
          groups={groups}
          chosenVideos={chosenVideos}
          chosenImages={chosenImages}
          onLaunch={() => setDialog('confirm')}
        />
      </div>

      {dialog === 'clone' && <CloneDialog candidates={candidates} error={siblings.error} onClose={() => setDialog(undefined)} onClone={clone} />}
      {confirming && (
        <LaunchConfirm
          plan={confirming.plan}
          blockers={confirming.blockers}
          existing={existing || undefined}
          onClose={() => setDialog(undefined)}
          onConfirm={async () => {
            // the record must hold what is about to be launched
            if (!(await autosave.save())) return 'The draft could not be saved, so nothing was launched. Check the connection and try again.'
            setDialog(undefined)
            startLaunch(confirming.plan)
            return undefined
          }}
        />
      )}
    </>
  )
}

export function CampaignLauncher() {
  const { id } = useParams()
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const campaign = useFetch<ApiRecord>(isAdmin ? `/data/campaigns/${id}` : null)

  if (!isAdmin) return <p className="text-sm text-neutral-600">Only admins can launch campaigns.</p>
  if (campaign.error) return <p className="text-sm text-red-700">Could not load this campaign: {campaign.error.message}</p>
  if (!campaign.data) return <p className="text-sm text-neutral-500">Loading…</p>
  // a fresh draft for each campaign
  return <Launcher key={campaign.data.id} campaign={campaign.data} onReload={campaign.reload} />
}
