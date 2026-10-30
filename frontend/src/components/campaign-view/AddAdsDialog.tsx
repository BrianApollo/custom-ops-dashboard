import { Check, Search, X } from 'lucide-react'
import { Checkbox, Dialog, Tabs } from 'radix-ui'
import { useState } from 'react'
import { useAuth } from '../../auth'
import { useAllPages, useFetch } from '../../data'
import { api, ApiError, text, type ApiRecord } from '../../lib/api'
import { withCred } from '../../lib/facebook'
import { checkbox } from '../DataTable'
import { matchesSearch } from '../../lib/search'
import { button, Select, StatusBadge } from '../ui'
import { alertBox, chunks, Confirm, messageOf, modal, noteBox, refusedUnsent, sleep, useAlive, type Confirmation, type FbState, type VideoRow } from './shared'

// Adds ads to an ad set of a live Facebook campaign: the user ticks more of the
// product's videos and images, and each becomes one ad that copies its text,
// link and page from an ad already in the ad set. Videos are uploaded to the ad
// account first when they are not there yet. Ads that were created are recorded
// on our campaign record (POST /campaigns/{id}/media) and their videos marked Used.
//
// Render it only while it should be open; it calls `onClose` when dismissed.
// Admins only: every route it uses refuses other roles.
export interface AddAdsProps {
  // the Facebook campaign to add ads to
  fbCampaignId: string
  // its ad account, with or without `act_`
  fbAdAccountId: string
  // whose token to use: `profile:rec…`, `bm:rec…`, or '' for the Master Profile
  cred: string
  // our campaign record's id. Left out, the record is looked up by `fbCampaignId`
  // (GET /campaigns/by-fb-id); a Facebook campaign with no record here cannot be added to.
  campaignId?: string
  // the ad set to start on; the first one when left out. The user can pick another.
  adSetId?: string
  onClose: () => void
  // called on closing when at least one ad was created, with how many, so the opener can reload
  onAdded?: (created: number) => void
}

const UPLOAD_BATCH = 10
const AD_BATCH = 25
const STATUS_BATCH = 50
const POLL_MS = 5000
// how long Facebook is given to process uploaded videos
const WAIT_MS = 10 * 60 * 1000
const AD_ATTEMPTS = 3
const FILTERS = ['Not used', 'Used']

interface ImageRow {
  id: string
  // `temp` rows are generated images not yet approved
  source: string
  name: string
  url: string | null
  status: string
}

interface Item {
  id: string
  kind: 'video' | 'ai' | 'image'
  name: string
  status: string
  // the file in our storage; Facebook is refused anything else
  url: string | null
}

// GET /facebook/creatives/{id}
interface Creative {
  url_tags?: string
  degrees_of_freedom_spec?: unknown
  object_story_spec?: {
    page_id?: string
    video_data?: StoryData
    link_data?: StoryData & { link?: string; name?: string; description?: string }
  }
  asset_feed_spec?: {
    bodies?: { text?: string }[]
    titles?: { text?: string }[]
    descriptions?: { text?: string }[]
    link_urls?: { website_url?: string }[]
    call_to_action_types?: string[]
  }
}

interface StoryData {
  message?: string
  title?: string
  link_description?: string
  call_to_action?: { type?: string; value?: { link?: string } }
}

interface LibraryVideo {
  id: string
  title?: string
  status?: string
  picture: string | null
}

interface AdResult {
  name: string
  success: boolean
  adId: string | null
  error: string | null
}

const present = (values: (string | undefined)[]) => values.map((value) => value?.trim() ?? '').filter(Boolean)

// What every new ad copies from the template ad
function templateFrom(creative: Creative, pageFallback: string, urlFallback: string) {
  const story = creative.object_story_spec
  const media = story?.video_data ?? story?.link_data
  const feed = creative.asset_feed_spec
  // the texts sit in the feed for ads made here; an ad made by hand keeps them on the story
  const texts = (entries: { text?: string }[] | undefined, single: string | undefined) => {
    const fromFeed = present((entries ?? []).map((entry) => entry.text))
    return fromFeed.length ? fromFeed : present([single])
  }
  return {
    pageId: story?.page_id ?? pageFallback,
    websiteUrl: present([media?.call_to_action?.value?.link, story?.link_data?.link, feed?.link_urls?.[0]?.website_url, urlFallback])[0] ?? '',
    callToAction: media?.call_to_action?.type ?? feed?.call_to_action_types?.[0] ?? 'SHOP_NOW',
    bodies: texts(feed?.bodies, media?.message),
    titles: texts(feed?.titles, story?.video_data?.title ?? story?.link_data?.name),
    descriptions: texts(feed?.descriptions, story?.video_data?.link_description ?? story?.link_data?.description),
    urlTags: creative.url_tags ?? '',
    advantagePlusCreative: Boolean(creative.degrees_of_freedom_spec),
  }
}

interface ListProps {
  // undefined while loading
  items?: Item[]
  noun: string
  chosen: Set<string>
  onChosen: (ids: Set<string>) => void
}

function MediaList({ items, noun, chosen, onChosen }: ListProps) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState(FILTERS[0])
  const term = search.trim().toLowerCase()
  // a ticked item stays in sight when the filter would hide it, so nothing is chosen unseen
  const shown = (items ?? []).filter(
    (item) => matchesSearch(term, item.name) && ((filter === 'Used') === (item.status === 'Used') || chosen.has(item.id)),
  )
  const pickable = shown.filter((item) => item.url)
  const shownChosen = pickable.filter((item) => chosen.has(item.id)).length

  function set(ids: string[], on: boolean) {
    const next = new Set(chosen)
    for (const id of ids) {
      if (on) next.add(id)
      else next.delete(id)
    }
    onChosen(next)
  }

  return (
    <div className="rounded-md border border-neutral-200">
      <div className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-neutral-400" />
          <input
            type="search"
            aria-label={`Search ${noun}`}
            placeholder={`Search ${noun}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="block h-8 w-full rounded-md border border-neutral-300 bg-white pr-2 pl-8 text-sm outline-none placeholder:text-neutral-400 focus:border-blue-700 focus:ring-1 focus:ring-blue-700"
          />
        </div>
        <Select label={`Show ${noun}`} value={filter} options={FILTERS} onValueChange={setFilter} />
      </div>
      {pickable.length > 0 && (
        <label className="flex items-center gap-3 border-b border-neutral-200 px-3 py-2 text-sm text-neutral-600">
          <Checkbox.Root
            checked={shownChosen === 0 ? false : shownChosen === pickable.length ? true : 'indeterminate'}
            onCheckedChange={(on) => set(pickable.map((item) => item.id), on === true)}
            className={checkbox}
          >
            <Checkbox.Indicator>
              <Check className="size-3" />
            </Checkbox.Indicator>
          </Checkbox.Root>
          {shownChosen ? `${shownChosen} of ${pickable.length} selected` : `Select all ${pickable.length}`}
        </label>
      )}
      <ul className="max-h-72 divide-y divide-neutral-100 overflow-y-auto">
        {shown.map((item) => (
          <li key={item.id}>
            <label
              className={`flex items-center gap-3 px-3 py-2 text-sm ${item.url ? 'cursor-pointer' : 'text-neutral-400'} ${chosen.has(item.id) ? 'bg-blue-50/60' : item.url ? 'hover:bg-neutral-50' : ''}`}
            >
              <Checkbox.Root
                checked={chosen.has(item.id)}
                disabled={!item.url}
                onCheckedChange={(on) => set([item.id], on === true)}
                className={`${checkbox} shrink-0 disabled:opacity-50`}
              >
                <Checkbox.Indicator>
                  <Check className="size-3" />
                </Checkbox.Indicator>
              </Checkbox.Root>
              {item.kind === 'image' && item.url && <img src={item.url} alt="" loading="lazy" className="size-8 shrink-0 rounded object-cover" />}
              <span className="min-w-0 flex-1 truncate" title={item.name}>
                {item.name}
              </span>
              {item.kind === 'ai' && <span className="text-xs text-neutral-500">AI</span>}
              {item.url ? <StatusBadge status={item.status} /> : <span className="text-xs">No file uploaded</span>}
            </label>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="px-3 py-8 text-center text-sm text-neutral-500">
            {!items ? 'Loading…' : items.length === 0 ? `This product has no ${noun} to add.` : `No ${noun} match.`}
          </li>
        )}
      </ul>
    </div>
  )
}

interface Run {
  phase: 'idle' | 'working' | 'done'
  step: string
  created: number
  // one line per video or image that did not become an ad, with Facebook's reason
  failures: string[]
  // the ads exist but our own records could not be updated
  warning?: string
}

export function AddAdsDialog({ fbCampaignId, fbAdAccountId, cred, onClose, onAdded, ...props }: AddAdsProps) {
  const { expire } = useAuth()
  const alive = useAlive()
  const [tab, setTab] = useState('videos')
  const [videoIds, setVideoIds] = useState<Set<string>>(new Set())
  const [imageIds, setImageIds] = useState<Set<string>>(new Set())
  const [adSetChoice, setAdSetChoice] = useState(props.adSetId ?? '')
  const [reuse, setReuse] = useState(true)
  // new ads start paused unless the user asks otherwise
  const [active, setActive] = useState(false)
  const [confirming, setConfirming] = useState<Confirmation | null>(null)
  const [run, setRun] = useState<Run>({ phase: 'idle', step: '', created: 0, failures: [] })

  const link = useFetch<{ campaigns: { id: string }[] }>(props.campaignId ? null : `/campaigns/by-fb-id?ids=${fbCampaignId}`)
  const recordId = props.campaignId ?? link.data?.campaigns[0]?.id
  const record = useFetch<ApiRecord>(recordId ? `/data/campaigns/${recordId}` : null)
  const productId = (record.data?.fields.Product as string[] | undefined)?.[0]
  const fb = useFetch<FbState>(withCred(`/facebook/campaigns/${fbCampaignId}`, cred))

  const byProduct = productId ? new URLSearchParams({ productId, sort: 'name' }) : null
  const videos = useAllPages<VideoRow>(byProduct && `/videos?${byProduct}`)
  const aiVideos = useAllPages<VideoRow>(byProduct && `/videos?kind=ai&${byProduct}`)
  const images = useAllPages<ImageRow>(byProduct && `/images?${byProduct}`)

  const adSets = fb.data?.adSets ?? []
  const adSet = adSets.find((set) => set.id === adSetChoice) ?? adSets[0]
  // the new ads copy an ad of the same ad set; an empty ad set borrows one from the campaign
  const withCreative = (fb.data?.ads ?? []).filter((ad) => ad.creative?.id)
  const templateAd = withCreative.find((ad) => ad.adset_id === adSet?.id) ?? withCreative[0]
  const creative = useFetch<Creative>(templateAd?.creative ? withCred(`/facebook/creatives/${templateAd.creative.id}`, cred) : null)
  const template =
    creative.data && templateFrom(creative.data, templateAd?.creative?.actor_id ?? '', record.data ? text(record.data, 'Website Url') : '')

  const videoItems: Item[] | undefined =
    videos.data && aiVideos.data
      ? [
          // a video still To Do has no finished file, and a YouTube cut is not an ad format
          ...videos.data.records
            .filter((video) => ['Available', 'Review', 'Used'].includes(video.status ?? '') && !/youtube/i.test(video.format ?? ''))
            .map((video): Item => ({ id: video.id, kind: 'video', name: video.name, status: video.status ?? '', url: video.creativeLink })),
          ...aiVideos.data.records.map(
            (video): Item => ({ id: video.id, kind: 'ai', name: video.name, status: video.status ?? '', url: video.creativeLink }),
          ),
        ].sort((a, b) => a.name.localeCompare(b.name))
      : undefined
  const imageItems: Item[] | undefined = images.data?.records
    .filter((image) => image.source === 'image')
    .map((image) => ({ id: image.id, kind: 'image', name: image.name, status: image.status, url: image.url }))

  const chosenVideos = (videoItems ?? []).filter((item) => videoIds.has(item.id) && item.url)
  const chosenImages = (imageItems ?? []).filter((item) => imageIds.has(item.id) && item.url)
  const total = chosenVideos.length + chosenImages.length

  const loadError = link.error ?? record.error ?? fb.error ?? creative.error
  const mediaError = videos.error ?? aiVideos.error ?? images.error
  // why ads cannot be created here, once enough has loaded to know
  const blocked = loadError
    ? `Could not load what is needed to add ads: ${loadError.message}`
    : link.data && !recordId
      ? 'This Facebook campaign is not linked to a campaign here, so there is no product to take videos and images from.'
      : record.data && !productId
        ? 'This campaign has no product, so there are no videos or images to offer.'
        : fb.data && !adSet
          ? 'This campaign has no ad set to add ads to.'
          : fb.data && !templateAd
            ? 'This campaign has no ad to copy the text, link and page from.'
            : template && !template.pageId
              ? 'The ad being copied does not name a Facebook page.'
              : template && !template.websiteUrl
                ? "Could not find the destination URL on the ad being copied. Set the campaign's website URL and try again."
                : undefined

  const working = run.phase === 'working'

  function close() {
    if (working) return
    if (run.created > 0) onAdded?.(run.created)
    onClose()
  }

  async function create() {
    if (!template || !adSet || !recordId) return
    const account = `/facebook/ad-accounts/${encodeURIComponent(fbAdAccountId)}`
    const post = <T,>(path: string, body: unknown) => api<T>(path, { method: 'POST', body })
    const step = (message: string) => alive.current && setRun((current) => ({ ...current, step: message }))
    const failures: string[] = []
    const created: Item[] = []
    let warning: string | undefined
    setRun({ phase: 'working', step: 'Starting…', created: 0, failures: [] })

    try {
      // our video id -> the video in the ad account's library
      const ready = new Map<string, { fbVideoId: string; thumbnailUrl: string }>()
      const processing = new Map<string, string>()

      if (chosenVideos.length && reuse) {
        step('Looking for these videos in the ad account…')
        const found = await post<{ results: LibraryVideo[] }>(`${account}/videos/check`, { cred, names: chosenVideos.map((video) => video.name) })
        for (const video of chosenVideos) {
          // the library can hold several videos with one title; a finished one is preferred
          const matches = found.results.filter((result) => result.title === video.name)
          const done = matches.find((result) => result.status === 'ready' && result.picture)
          const waiting = matches.find((result) => result.status === 'processing')
          if (done?.picture) ready.set(video.id, { fbVideoId: done.id, thumbnailUrl: done.picture })
          else if (waiting) processing.set(video.id, waiting.id)
        }
      }

      const toUpload = chosenVideos.filter((video) => !ready.has(video.id) && !processing.has(video.id))
      let uploaded = 0
      const upload = async (batch: Item[]): Promise<void> => {
        step(`Sending videos to Facebook (${uploaded} of ${toUpload.length})…`)
        try {
          const sent = await post<{ results: { success: boolean; fbVideoId: string | null; error: string | null }[] }>(`${account}/videos/upload`, {
            cred,
            videos: batch.map((video) => ({ name: video.name, url: video.url })),
          })
          batch.forEach((video, i) => {
            const result = sent.results[i]
            if (result?.success && result.fbVideoId) processing.set(video.id, result.fbVideoId)
            else failures.push(`${video.name}: ${result?.error ?? 'Facebook returned no video id'}`)
          })
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) throw error
          // one file our API will not pass on must not cost the others their upload
          if (refusedUnsent(error) && batch.length > 1) {
            for (const video of batch) await upload([video])
            return
          }
          for (const video of batch) failures.push(`${video.name}: ${messageOf(error)}`)
        }
        uploaded += batch.length
      }
      for (const batch of chunks(toUpload, UPLOAD_BATCH)) await upload(batch)

      // Facebook processes each upload for a while before an ad can use it
      const deadline = Date.now() + WAIT_MS
      let misses = 0
      while (processing.size && alive.current) {
        step(`Facebook is processing ${processing.size} ${processing.size === 1 ? 'video' : 'videos'}…`)
        await sleep(POLL_MS)
        try {
          const states = new Map<string, LibraryVideo>()
          for (const ids of chunks([...processing.values()], STATUS_BATCH)) {
            const answer = await post<{ results: LibraryVideo[] }>(`${account}/videos/status`, { cred, videoIds: ids })
            for (const video of answer.results) states.set(video.id, video)
          }
          misses = 0
          for (const video of chosenVideos) {
            const fbVideoId = processing.get(video.id)
            const state = fbVideoId ? states.get(fbVideoId) : undefined
            if (!fbVideoId || !state) continue
            if (state.status === 'ready' && state.picture) {
              ready.set(video.id, { fbVideoId, thumbnailUrl: state.picture })
              processing.delete(video.id)
            } else if (state.status === 'error') {
              failures.push(`${video.name}: Facebook could not process the video`)
              processing.delete(video.id)
            }
          }
        } catch (error) {
          // a single failed check is not the end; three in a row is
          if ((error instanceof ApiError && error.status === 401) || ++misses >= 3) throw error
        }
        if (processing.size && Date.now() > deadline) {
          for (const video of chosenVideos) {
            if (processing.has(video.id)) failures.push(`${video.name}: Facebook was still processing the video after 10 minutes`)
          }
          processing.clear()
        }
      }
      if (!alive.current) return

      const adCreative = {
        websiteUrl: template.websiteUrl,
        callToAction: template.callToAction,
        bodies: template.bodies,
        titles: template.titles,
        descriptions: template.descriptions,
        urlTags: template.urlTags,
        advantagePlusCreative: template.advantagePlusCreative,
        status: active ? 'ACTIVE' : 'PAUSED',
      }
      const mediaOf = (item: Item) =>
        item.kind === 'image'
          ? { type: 'image', name: item.name, url: item.url }
          : { type: 'video', name: item.name, ...ready.get(item.id) }

      const wanted = [...chosenVideos.filter((video) => ready.has(video.id)), ...chosenImages]
      // the reason each item last failed, for the ones that never succeed
      const reasons = new Map<string, string>()
      let queue = wanted
      for (let attempt = 1; attempt <= AD_ATTEMPTS && queue.length; attempt++) {
        if (attempt > 1) await sleep(2000)
        const again: Item[] = []
        const send = async (batch: Item[]): Promise<void> => {
          step(`Creating ads (${created.length} of ${wanted.length})…`)
          try {
            const answer = await post<{ results: AdResult[] }>(`${account}/ads`, {
              cred,
              adSetId: adSet.id,
              pageId: template.pageId,
              adCreative,
              media: batch.map(mediaOf),
            })
            batch.forEach((item, i) => {
              const result = answer.results[i]
              if (result?.success) {
                created.push(item)
              } else {
                reasons.set(item.id, result?.error ?? 'Facebook returned no ad id')
                again.push(item)
              }
            })
          } catch (error) {
            if (error instanceof ApiError && error.status === 401) throw error
            if (refusedUnsent(error)) {
              // nothing reached Facebook: find the item at fault by sending them singly
              if (batch.length > 1) for (const item of batch) await send([item])
              else failures.push(`${batch[0].name}: ${messageOf(error)}`)
              return
            }
            // the request may have got through, so trying again could make the same ads twice
            for (const item of batch) failures.push(`${item.name}: ${messageOf(error)} (not retried; check the ad set before adding it again)`)
          }
        }
        for (const batch of chunks(queue, AD_BATCH)) await send(batch)
        queue = again
      }
      for (const item of queue) failures.push(`${item.name}: ${reasons.get(item.id) ?? 'Facebook did not create the ad'}`)

      if (created.length) {
        step('Recording the new ads…')
        const idsOf = (kind: Item['kind']) => created.filter((item) => item.kind === kind).map((item) => item.id)
        try {
          await post(`/campaigns/${recordId}/media`, { videoIds: idsOf('video'), aiVideoIds: idsOf('ai'), imageIds: idsOf('image') })
          for (const [table, kind] of [
            ['videos', 'video'],
            ['ai_videos', 'ai'],
          ] as const) {
            for (const ids of chunks(idsOf(kind), 200)) {
              await api(`/data/${table}`, { method: 'PATCH', body: { records: ids.map((id) => ({ id, fields: { Status: 'Used' } })) } })
            }
          }
        } catch (error) {
          warning = `The ads were created, but recording them on this campaign failed: ${messageOf(error)}`
        }
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return expire()
      failures.push(messageOf(error))
    }
    if (alive.current) setRun({ phase: 'done', step: '', created: created.length, failures, warning })
  }

  const trigger =
    'border-b-2 border-transparent px-1 py-2 text-sm font-medium text-neutral-600 hover:text-neutral-900 focus-visible:outline-2 focus-visible:outline-blue-700 data-[state=active]:border-blue-700 data-[state=active]:text-blue-800'
  const count = (chosen: number, items?: Item[]) => (chosen ? `${chosen}/${items?.length ?? '…'}` : (items?.length ?? '…'))
  const option = (label: string, checked: boolean, onChecked: (on: boolean) => void) => (
    <label className="flex items-center gap-3 text-sm text-neutral-700">
      <Checkbox.Root checked={checked} onCheckedChange={(on) => onChecked(on === true)} className={`${checkbox} shrink-0`}>
        <Checkbox.Indicator>
          <Check className="size-3" />
        </Checkbox.Indicator>
      </Checkbox.Root>
      {label}
    </label>
  )

  return (
    <Dialog.Root open onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay className={modal.overlay} />
        <Dialog.Content aria-describedby={undefined} className={`${modal.content} max-w-2xl`}>
          <div className={modal.header}>
            <Dialog.Title className="text-base font-semibold">Add ads</Dialog.Title>
            <Dialog.Close aria-label="Close" disabled={working} className={button.icon}>
              <X className="size-4" />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4 text-sm">
            {blocked ? (
              <p role="alert" className={alertBox}>
                {blocked}
              </p>
            ) : run.phase === 'working' ? (
              <div role="status" className="py-8 text-center">
                <p className="font-medium">{run.step}</p>
                <p className="mt-1 text-neutral-500">Keep this window open until it finishes. Videos can take several minutes.</p>
              </div>
            ) : run.phase === 'done' ? (
              <div className="space-y-3" role="status">
                <p className={run.created ? 'font-medium text-emerald-800' : 'font-medium'}>
                  {run.created === 1 ? 'Created 1 ad' : `Created ${run.created} ads`}
                  {run.created > 0 && (active ? ', now active.' : ', paused.')}
                  {run.created === 0 && '.'}
                </p>
                {run.warning && <p className={noteBox}>{run.warning}</p>}
                {run.failures.length > 0 && (
                  <div className={alertBox}>
                    <p className="font-medium">{run.failures.length} failed:</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">
                      {run.failures.map((failure, i) => (
                        <li key={i} className="wrap-break-word">
                          {failure}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="rounded-md bg-neutral-50 px-3 py-2 text-neutral-700">
                  {!fb.data || !template ? (
                    'Loading the ad to copy from Facebook…'
                  ) : (
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                      <dt className="text-neutral-500">Ad set</dt>
                      <dd>
                        {adSets.length > 1 ? (
                          <Select
                            label="Ad set"
                            value={adSet.id}
                            options={adSets.map((set) => ({ value: set.id, label: set.name }))}
                            onValueChange={setAdSetChoice}
                            className="max-w-full"
                          />
                        ) : (
                          adSet.name
                        )}
                      </dd>
                      <dt className="text-neutral-500">Copies</dt>
                      <dd className="truncate" title={templateAd.name}>
                        {templateAd.name}
                      </dd>
                      <dt className="text-neutral-500">Page</dt>
                      <dd className="tabular-nums">{template.pageId}</dd>
                      <dt className="text-neutral-500">Button</dt>
                      <dd>{template.callToAction}</dd>
                      <dt className="text-neutral-500">Link</dt>
                      <dd className="truncate" title={template.websiteUrl}>
                        {template.websiteUrl}
                      </dd>
                    </dl>
                  )}
                </div>

                {mediaError ? (
                  <p role="alert" className={alertBox}>
                    Could not load the product's media: {mediaError.message}
                  </p>
                ) : (
                  <Tabs.Root value={tab} onValueChange={setTab}>
                    <Tabs.List aria-label="Media type" className="mb-3 flex gap-4 border-b border-neutral-200">
                      <Tabs.Trigger value="videos" className={trigger}>
                        Videos ({count(chosenVideos.length, videoItems)})
                      </Tabs.Trigger>
                      <Tabs.Trigger value="images" className={trigger}>
                        Images ({count(chosenImages.length, imageItems)})
                      </Tabs.Trigger>
                    </Tabs.List>
                    <Tabs.Content value="videos" className="outline-none">
                      <MediaList items={videoItems} noun="videos" chosen={videoIds} onChosen={setVideoIds} />
                    </Tabs.Content>
                    <Tabs.Content value="images" className="outline-none">
                      <MediaList items={imageItems} noun="images" chosen={imageIds} onChosen={setImageIds} />
                    </Tabs.Content>
                  </Tabs.Root>
                )}

                <div className="space-y-2">
                  {option('Use videos already in the ad account instead of uploading them again', reuse, setReuse)}
                  {option('Turn the new ads on immediately (otherwise they are created paused)', active, setActive)}
                </div>
              </>
            )}
          </div>

          <div className={modal.footer}>
            {run.phase === 'done' || blocked ? (
              <button onClick={close} className={button.primary}>
                {run.phase === 'done' ? 'Done' : 'Close'}
              </button>
            ) : (
              <>
                <button onClick={close} disabled={working} className={button.secondary}>
                  Cancel
                </button>
                <button
                  disabled={working || total === 0 || !template || !adSet || !recordId}
                  onClick={() =>
                    setConfirming({
                      title: total === 1 ? 'Create 1 ad?' : `Create ${total} ads?`,
                      body: active
                        ? `They are added to the ad set “${adSet?.name}” of a live campaign and start delivering as soon as Facebook approves them.`
                        : `They are added to the ad set “${adSet?.name}” paused, and deliver nothing until you turn them on.`,
                      action: total === 1 ? 'Create ad' : 'Create ads',
                      run: () => void create(),
                    })
                  }
                  className={button.primary}
                >
                  {working ? 'Working…' : total === 1 ? 'Create 1 ad' : `Create ${total} ads`}
                </button>
              </>
            )}
          </div>

          <Confirm confirmation={confirming} onClose={() => setConfirming(null)} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
