import { useSyncExternalStore } from 'react'
import { api, ApiError } from '../../lib/api'
import { withCred } from '../../lib/facebook'

// The launch itself: library check, video uploads, campaign, ad set, then one ad
// per media item. Every Facebook call goes through our API.
//
// A launch spends money on a live ad account, so three rules hold throughout:
//   1. A call that may have created something is never repeated before looking
//      on Facebook for what it made.
//   2. Whatever was created is written to the campaign record, however the launch ended.
//   3. The campaign is marked Launched only when at least one ad exists.
//
// Runs live outside React, so a launch carries on (and records its result) when
// the user moves to another page of the dashboard, and is still there on return.

export type ItemState = 'queued' | 'uploading' | 'processing' | 'ready' | 'creating' | 'done' | 'failed'
export type StepState = 'pending' | 'active' | 'done' | 'error' | 'skipped'
export type Step = 'library' | 'upload' | 'campaign' | 'adSet' | 'ads'

export interface LaunchMedia {
  // our record id
  id: string
  name: string
  kind: 'video' | 'ai' | 'image'
  url: string
}

export interface LaunchItem extends LaunchMedia {
  state: ItemState
  fbVideoId?: string
  thumbnailUrl?: string
  adId?: string
  // the last thing that went wrong, also while the item is being tried again
  error?: string
  failedAt?: 'upload' | 'processing' | 'ad-creation'
  uploads: number
  attempts: number
  lookups: number
  // look in the ad account's library before uploading: the video may already be there
  checkLibrary: boolean
  // look at the campaign's ads before asking for this one: an earlier request may have made it
  checkAds: boolean
}

interface Named {
  id: string
  name: string
}

export interface LaunchPlan {
  // our campaign record
  campaignId: string
  cred: string
  token: { kind: 'profile' | 'bm'; recordId: string; name: string; bmId?: string; systemUserId?: string }
  adAccount: Named & { timezoneName: string; currency: string }
  page: Named
  pixel: Named
  name: string
  // per day, in the ad account's currency
  budget: number
  budgetCents: number
  countries: string[]
  // as typed, and as the moment it means in the ad account's time zone (Unix seconds)
  start: string
  startTime: number
  status: 'ACTIVE' | 'PAUSED'
  websiteUrl: string
  urlTags: string
  displayLink: string
  ctaLabel: string
  callToAction: string
  bodies: string[]
  titles: string[]
  descriptions: string[]
  beneficiaryName?: string
  payerName?: string
  preset: Named
  redtrack?: Named
  reuse: boolean
  media: LaunchMedia[]
}

export interface LaunchRun {
  plan: LaunchPlan
  phase: 'running' | 'stopping' | 'finished'
  steps: Record<Step, StepState>
  // what is happening right now
  activity: string
  items: LaunchItem[]
  fbCampaignId?: string
  fbAdSetId?: string
  // why the launch ended early
  error?: string
  // whether the campaign record knows what was created; `launched` once it is marked Launched
  record: { state: 'none' | 'saving' | 'saved' | 'failed'; error?: string; launched: boolean }
}

const UPLOAD_BATCH = 10
const AD_BATCH = 25
const STATUS_BATCH = 50
const MAX_TRIES = 3
const TICK_MS = 10_000
// how long the launch waits with nothing changing, e.g. for Facebook to process videos
const PATIENCE_MS = 30 * 60_000

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
// our API refused the request before anything reached Facebook
const refused = (err: unknown) => err instanceof ApiError && err.status < 500
// the session or the token is gone: no later call can succeed
const hopeless = (err: unknown) =>
  err instanceof ApiError &&
  (err.status === 401 || err.status === 403 || err.code === 'facebook_token_invalid' || err.code === 'facebook_token_missing')

// Facebook writes `2026-10-11T08:00:00-0700`, which not every browser reads without the colon
const created = (time: string | undefined) => Date.parse((time ?? '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))

function chunks<T>(list: T[], size: number) {
  return Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))
}

const finished = (item: LaunchItem) => item.state === 'done' || item.state === 'failed'

// The record of a launch kept on the campaign, in the shape earlier launches were stored in
function snapshot(run: LaunchRun) {
  const { plan, items } = run
  const now = new Date().toISOString()
  const videos = items.filter((item) => item.kind !== 'image')
  const images = items.filter((item) => item.kind === 'image')
  const done = (list: LaunchItem[]) => list.filter((item) => item.state === 'done')
  const failed = (list: LaunchItem[]) => list.filter((item) => item.state !== 'done')
  const failure = (item: LaunchItem) => ({
    localId: item.id,
    name: item.name,
    error: item.error ?? 'No ad was created',
    failedAt: item.failedAt ?? (item.kind === 'image' || item.fbVideoId ? 'ad-creation' : 'upload'),
  })
  const adsCreated = done(items).length
  const adsFailed = items.length - adsCreated
  return {
    version: 1,
    launchedAt: now,
    config: {
      campaignName: plan.name,
      budget: plan.budget,
      budgetCents: plan.budgetCents,
      geo: plan.countries,
      startDate: plan.start.split('T')[0],
      startTime: plan.start.split('T')[1],
      startTimeUnix: plan.startTime,
      websiteUrl: plan.websiteUrl,
      utms: plan.urlTags,
      displayLink: plan.displayLink,
      ctaOverride: plan.ctaLabel,
      launchStatus: plan.status,
    },
    facebook: {
      adAccount: { id: plan.adAccount.id, name: plan.adAccount.name, timezone: plan.adAccount.timezoneName, currency: plan.adAccount.currency },
      page: plan.page,
      pixel: plan.pixel,
      campaign: { id: run.fbCampaignId, name: plan.name },
      profile:
        plan.token.kind === 'profile'
          ? { id: plan.token.recordId, name: plan.token.name }
          : { id: '', name: `System User (${plan.token.name})` },
      ...(plan.token.kind === 'bm'
        ? {
            systemUser: {
              bmRecordId: plan.token.recordId,
              bmId: plan.token.bmId ?? '',
              bmName: plan.token.name,
              systemUserId: plan.token.systemUserId ?? '',
            },
          }
        : {}),
      adSet: { id: run.fbAdSetId ?? '', name: `${plan.name} - AdSet` },
      adIds: done(items).map((item) => item.adId),
    },
    adPreset: {
      id: plan.preset.id,
      name: plan.preset.name,
      primaryTexts: plan.bodies,
      headlines: plan.titles,
      descriptions: plan.descriptions,
      callToAction: plan.callToAction,
    },
    ...(plan.redtrack ? { redtrack: { campaignId: plan.redtrack.id, campaignName: plan.redtrack.name } } : {}),
    media: {
      summary: {
        videosAttempted: videos.length,
        videosSucceeded: done(videos).length,
        videosFailed: failed(videos).length,
        imagesAttempted: images.length,
        imagesSucceeded: done(images).length,
        imagesFailed: failed(images).length,
      },
      videos: {
        succeeded: done(videos).map((item) => ({
          localId: item.id,
          name: item.name,
          fbMediaId: item.fbVideoId,
          thumbnailUrl: item.thumbnailUrl,
          adId: item.adId,
        })),
        failed: failed(videos).map(failure),
      },
      images: {
        succeeded: done(images).map((item) => ({ localId: item.id, name: item.name, imageUrl: item.url, adId: item.adId })),
        failed: failed(images).map(failure),
      },
    },
    result: {
      // true only when every ad went out
      success: adsCreated > 0 && adsFailed === 0,
      partialSuccess: adsCreated > 0 && adsFailed > 0,
      dryRun: false,
      adsAttempted: items.length,
      adsCreated,
      adsFailed,
      completedAt: now,
      errors: failed(items).map((item) => ({ mediaId: item.name, mediaName: item.name, stage: failure(item).failedAt, message: failure(item).error })),
    },
  }
}

const runs = new Map<string, LaunchRun>()
const runners = new Map<string, Runner>()
const listeners = new Set<() => void>()

// Closing or reloading the tab would end a launch part-way, whichever page of the dashboard is showing
window.addEventListener('beforeunload', (event) => {
  if ([...runs.values()].some((run) => run.phase !== 'finished' || run.record.state === 'saving')) event.preventDefault()
})

class Runner {
  private busy = false
  private stopping = false
  private adSetTried = false
  private wake: (() => void) | undefined

  constructor(private run: LaunchRun) {}

  // the page reads copies, so a half-made change is never drawn
  publish() {
    const { run } = this
    runs.set(run.plan.campaignId, { ...run, steps: { ...run.steps }, record: { ...run.record }, items: run.items.map((item) => ({ ...item })) })
    for (const listener of listeners) listener()
  }

  private say(activity: string) {
    this.run.activity = activity
    this.publish()
  }

  private post<T>(path: string, body: Record<string, unknown>) {
    const { plan } = this.run
    return api<T>(`/facebook/ad-accounts/${encodeURIComponent(plan.adAccount.id)}/${path}`, { method: 'POST', body: { cred: plan.cred, ...body } })
  }

  private fail(item: LaunchItem, error: string, failedAt: LaunchItem['failedAt']) {
    item.state = 'failed'
    item.error = error
    item.failedAt = failedAt
  }

  stop() {
    if (this.run.phase !== 'running') return
    this.stopping = true
    this.run.phase = 'stopping'
    this.publish()
    this.wake?.()
  }

  private wait(ms: number) {
    return new Promise<void>((resolve) => {
      const timer = window.setTimeout(resolve, ms)
      this.wake = () => {
        window.clearTimeout(timer)
        resolve()
      }
    })
  }

  async drive() {
    if (this.busy) return
    this.busy = true
    this.stopping = false
    const { run } = this
    run.phase = 'running'
    run.error = undefined
    this.publish()
    try {
      await this.library()
      await this.upload()
      if (!run.fbCampaignId) {
        if (this.stopping) throw new Error('Stopped before the campaign was created.')
        if (run.items.every((item) => item.state === 'failed')) throw new Error('No video could be uploaded, so no campaign was created.')
        await this.createCampaign()
      }
      if (!run.fbAdSetId) {
        if (this.stopping) throw new Error('Stopped before the ad set was created.')
        await this.createAdSet()
      }
      await this.loop()
    } catch (err) {
      run.error = message(err)
    } finally {
      await this.finish()
      this.busy = false
    }
  }

  // Finds queued videos that are already in the ad account's library, by title
  private async library() {
    const { run } = this
    const wanted = run.items.filter((item) => item.state === 'queued' && item.checkLibrary)
    if (!wanted.length) {
      if (run.steps.library === 'pending') run.steps.library = 'skipped'
      return
    }
    run.steps.library = 'active'
    this.say(`Looking for ${wanted.length} video${wanted.length === 1 ? '' : 's'} in the ad account's library…`)
    try {
      const { results } = await this.post<{ results: { id: string; title?: string; status?: string; picture: string | null }[] }>('videos/check', {
        names: [...new Set(wanted.map((item) => item.name))],
      })
      for (const item of wanted) {
        const matches = results.filter((video) => video.title === item.name)
        const ready = matches.find((video) => video.status === 'ready' && video.picture)
        const coming = matches.find((video) => video.status === 'ready' || video.status === 'processing')
        if (ready) {
          item.fbVideoId = ready.id
          item.thumbnailUrl = ready.picture ?? undefined
          item.state = 'ready'
          item.error = undefined
        } else if (coming) {
          item.fbVideoId = coming.id
          item.state = 'processing'
          item.error = undefined
        }
        item.checkLibrary = false
      }
      run.steps.library = 'done'
    } catch (err) {
      run.steps.library = 'error'
      // before a campaign exists, stopping costs nothing
      if (!run.fbCampaignId) {
        throw new Error(`The ad account's video library could not be read (${message(err)}). Nothing was created on Facebook.`)
      }
      // uploading without the look could put the same video in the library twice
      for (const item of wanted) this.fail(item, `The library could not be read to see whether this video is already there: ${message(err)}`, 'upload')
      if (hopeless(err)) throw err
    }
    this.publish()
  }

  private uploadFailed(item: LaunchItem, reason: string) {
    item.uploads++
    item.error = reason
    // the upload may have landed all the same, so the library is read before the next try
    item.checkLibrary = true
    if (item.uploads >= MAX_TRIES) this.fail(item, reason, 'upload')
    else item.state = 'queued'
  }

  private async upload() {
    const { run } = this
    const queued = run.items.filter((item) => item.state === 'queued' && !item.checkLibrary)
    if (!queued.length) {
      if (run.steps.upload === 'pending') run.steps.upload = 'skipped'
      return
    }
    run.steps.upload = 'active'
    // items with the same name are the same video on Facebook: one upload serves them all
    const byName = new Map<string, LaunchItem[]>()
    for (const item of queued) byName.set(item.name, [...(byName.get(item.name) ?? []), item])

    const batches = chunks([...byName.values()], UPLOAD_BATCH)
    for (const [index, batch] of batches.entries()) {
      if (this.stopping) break
      if (index > 0) await this.wait(1000)
      for (const item of batch.flat()) item.state = 'uploading'
      this.say(`Sending ${queued.length} video${queued.length === 1 ? '' : 's'} to Facebook (batch ${index + 1} of ${batches.length})…`)
      try {
        const { results } = await this.post<{ results: { success: boolean; fbVideoId: string | null; error: string | null }[] }>('videos/upload', {
          videos: batch.map((group) => ({ name: group[0].name, url: group[0].url })),
        })
        batch.forEach((group, i) => {
          const result = results[i]
          for (const item of group) {
            if (result?.success && result.fbVideoId) {
              item.fbVideoId = result.fbVideoId
              item.state = 'processing'
              item.error = undefined
            } else {
              this.uploadFailed(item, result?.error ?? 'Facebook returned no video id')
            }
          }
        })
      } catch (err) {
        for (const item of batch.flat()) {
          // refused by our API (for one, a file that is not in our storage): trying again cannot help
          if (refused(err)) this.fail(item, message(err), 'upload')
          else this.uploadFailed(item, message(err))
        }
        if (hopeless(err)) throw err
      }
      this.publish()
    }
    run.steps.upload = run.items.some((item) => item.kind !== 'image' && item.fbVideoId) ? 'done' : 'error'
    this.publish()
  }

  private async createCampaign() {
    const { run } = this
    const { plan } = run
    run.steps.campaign = 'active'
    this.say('Creating the campaign…')
    const askedAt = Date.now()
    let id: string | undefined
    try {
      const made = await this.post<{ id?: string }>('campaigns', {
        campaign: {
          name: plan.name,
          objective: 'OUTCOME_SALES',
          status: plan.status,
          specialAdCategories: [],
          dailyBudget: plan.budgetCents,
          bidStrategy: 'LOWEST_COST_WITHOUT_CAP',
        },
      })
      id = made.id
      if (!id) throw new Error('Facebook answered without a campaign id')
    } catch (err) {
      run.steps.campaign = 'error'
      if (refused(err)) throw new Error(`The campaign was not created: ${message(err)}. Nothing was created on Facebook.`)
      // It may exist all the same. It is looked for, and never asked for a second time.
      id = await this.findCampaign(askedAt, message(err))
    }
    run.fbCampaignId = id
    run.steps.campaign = 'done'
    this.publish()
    // noted on the campaign record at once, in case this tab does not live to the end
    await this.record(false)
  }

  private async findCampaign(askedAt: number, reason: string) {
    const { plan } = this.run
    const where = `"${plan.name}" in ${plan.adAccount.name}`
    this.say('Facebook did not confirm the campaign. Looking for it in the ad account…')
    let found: { id: string }[]
    try {
      const overview = await api<{
        campaigns: { id: string; name: string; created_time?: string; adAccountId: string }[]
        failedAdAccounts: string[]
      }>(withCred('/facebook/campaigns', plan.cred, { datePreset: 'today', refresh: '1' }))
      if (overview.failedAdAccounts.includes(plan.adAccount.id)) throw new Error('its campaigns could not be listed')
      found = overview.campaigns.filter(
        // two minutes of slack for clocks that disagree
        (c) => c.adAccountId === plan.adAccount.id && c.name === plan.name && !(created(c.created_time) < askedAt - 120_000),
      )
    } catch (lookup) {
      throw new Error(
        `Facebook did not confirm the campaign (${reason}), and the ad account could not be read to check (${message(lookup)}). Look in Ads Manager for a campaign named ${where} before launching again.`,
      )
    }
    if (found.length === 1) return found[0].id
    if (found.length === 0) {
      throw new Error(
        `Facebook did not confirm the campaign (${reason}). No new campaign named ${where} was found just now, but look in Ads Manager before launching again.`,
      )
    }
    throw new Error(
      `Facebook did not confirm the campaign (${reason}), and ${found.length} new campaigns named ${where} were found (${found.map((c) => c.id).join(', ')}). None was continued or recorded; check them in Ads Manager.`,
    )
  }

  private async createAdSet() {
    const { run } = this
    const { plan } = run
    run.steps.adSet = 'active'
    this.say('Creating the ad set…')
    const create = async () => {
      this.adSetTried = true
      const made = await this.post<{ id?: string }>('adsets', {
        campaignId: run.fbCampaignId,
        pixelId: plan.pixel.id,
        adSet: {
          name: `${plan.name} - AdSet`,
          optimizationGoal: 'OFFSITE_CONVERSIONS',
          billingEvent: 'IMPRESSIONS',
          status: plan.status,
          targeting: { geoLocations: { countries: plan.countries }, ageMin: 18, ageMax: 65 },
          promotedObject: { customEventType: 'PURCHASE' },
          startTime: plan.startTime,
          beneficiaryName: plan.beneficiaryName,
          payerName: plan.payerName,
        },
      })
      if (!made.id) throw new Error('Facebook answered without an ad set id')
      return made.id
    }
    const existing = async () =>
      (await api<{ adSets: { id: string }[] }>(withCred(`/facebook/campaigns/${run.fbCampaignId}`, plan.cred))).adSets[0]?.id

    try {
      let id: string | undefined
      // an earlier try may have made it without our hearing so
      if (this.adSetTried) id = await existing()
      if (!id) {
        try {
          id = await create()
        } catch (err) {
          if (refused(err)) throw err
          let looked = false
          try {
            id = await existing()
            looked = true
          } catch {
            // without the look, a second ad set could be made; the launch stops instead
          }
          if (!looked) throw new Error(`${message(err)}; and the campaign could not be read to see whether the ad set exists`)
          // the campaign has no ad set, so asking once more cannot make a second
          if (!id) id = await create()
        }
      }
      run.fbAdSetId = id
      run.steps.adSet = 'done'
      this.publish()
    } catch (err) {
      // one last look, so an ad set that was made after all is not lost
      const late = refused(err) ? undefined : await existing().catch(() => undefined)
      if (late) {
        run.fbAdSetId = late
        run.steps.adSet = 'done'
        this.publish()
        return
      }
      run.steps.adSet = 'error'
      throw new Error(`The ad set was not created: ${message(err)}`)
    }
  }

  // Asks Facebook how the videos it is processing are getting on
  private async poll() {
    const processing = this.run.items.filter((item) => item.state === 'processing' && item.fbVideoId)
    if (!processing.length) return
    this.say(`Waiting for Facebook to process ${processing.length} video${processing.length === 1 ? '' : 's'}…`)
    try {
      for (const ids of chunks([...new Set(processing.map((item) => item.fbVideoId!))], STATUS_BATCH)) {
        const { results } = await this.post<{ results: { id: string; status?: string; picture: string | null }[] }>('videos/status', { videoIds: ids })
        for (const video of results) {
          for (const item of processing.filter((candidate) => candidate.fbVideoId === video.id)) {
            // an ad needs the video's thumbnail, which arrives with `ready`
            if (video.status === 'ready' && video.picture) {
              item.thumbnailUrl = video.picture
              item.state = 'ready'
            } else if (video.status === 'error') {
              this.fail(item, 'Facebook could not process this video', 'processing')
            }
          }
        }
      }
    } catch (err) {
      // a missed look costs nothing; the next one asks again
      if (hopeless(err)) throw err
    }
    this.publish()
  }

  // Marks as done the items whose ad is already in the campaign
  private async matchAds() {
    const { run } = this
    const { ads } = await api<{ ads: { id: string; name: string }[] }>(withCred(`/facebook/campaigns/${run.fbCampaignId}`, run.plan.cred))
    const taken = new Set(run.items.map((item) => item.adId))
    for (const item of run.items.filter((candidate) => candidate.checkAds && candidate.state !== 'done')) {
      const ad = ads.find((candidate) => candidate.name === `Ad-${item.name}` && !taken.has(candidate.id))
      if (ad) {
        taken.add(ad.id)
        item.adId = ad.id
        item.state = 'done'
        item.error = undefined
        item.failedAt = undefined
      }
      item.checkAds = false
    }
  }

  private adFailed(item: LaunchItem, reason: string) {
    item.attempts++
    item.error = reason
    // the ad may exist all the same, so the campaign's ads are read before the next try
    item.checkAds = true
    if (item.attempts >= MAX_TRIES) this.fail(item, reason, 'ad-creation')
    else item.state = 'ready'
  }

  private async createAds() {
    const { run } = this
    const { plan } = run
    const unsure = run.items.filter((item) => item.state === 'ready' && item.checkAds)
    if (unsure.length) {
      try {
        await this.matchAds()
      } catch (err) {
        if (hopeless(err)) throw err
        // not asked for again until the campaign's ads can be read
        for (const item of unsure) {
          item.lookups++
          if (item.lookups >= MAX_TRIES) {
            this.fail(item, `The campaign's ads could not be read to see whether this ad was created (${message(err)}). Look in Ads Manager.`, 'ad-creation')
          }
        }
      }
    }

    const ready = run.items.filter((item) => item.state === 'ready' && !item.checkAds)
    for (const batch of chunks(ready, AD_BATCH)) {
      if (this.stopping) break
      for (const item of batch) item.state = 'creating'
      this.say(`Creating ${batch.length} ad${batch.length === 1 ? '' : 's'}…`)
      try {
        const { results } = await this.post<{ results: { success: boolean; adId: string | null; error: string | null }[] }>('ads', {
          adSetId: run.fbAdSetId,
          pageId: plan.page.id,
          adCreative: {
            websiteUrl: plan.websiteUrl,
            urlTags: plan.urlTags,
            callToAction: plan.callToAction,
            bodies: plan.bodies,
            titles: plan.titles,
            descriptions: plan.descriptions,
            advantagePlusCreative: true,
            status: plan.status,
          },
          media: batch.map((item) =>
            item.kind === 'image'
              ? { type: 'image', name: item.name, url: item.url }
              : { type: 'video', name: item.name, fbVideoId: item.fbVideoId, thumbnailUrl: item.thumbnailUrl },
          ),
        })
        batch.forEach((item, i) => {
          const result = results[i]
          if (result?.success && result.adId) {
            item.adId = result.adId
            item.state = 'done'
            item.error = undefined
          } else {
            this.adFailed(item, result?.error ?? 'Facebook returned no ad id')
          }
        })
      } catch (err) {
        for (const item of batch) {
          // refused by our API before anything was sent: trying again cannot help
          if (refused(err) && !hopeless(err)) this.fail(item, message(err), 'ad-creation')
          else this.adFailed(item, message(err))
        }
        if (hopeless(err)) throw err
      }
      this.publish()
    }
  }

  private async loop() {
    const { run } = this
    run.steps.ads = 'active'
    const signature = () => run.items.map((item) => `${item.state}${item.uploads}${item.attempts}${item.lookups}`).join()
    let last = signature()
    let changedAt = Date.now()
    for (;;) {
      if (this.stopping) break
      await this.poll()
      if (this.stopping) break
      await this.createAds()
      if (this.stopping) break
      // videos whose upload failed go round again, after a look in the library
      await this.library()
      await this.upload()
      if (run.items.every(finished)) break

      const now = signature()
      if (now !== last) {
        last = now
        changedAt = Date.now()
      } else if (Date.now() - changedAt > PATIENCE_MS) {
        run.error = 'Nothing changed for 30 minutes, so the launch stopped waiting.'
        break
      }
      const count = (state: ItemState) => run.items.filter((item) => item.state === state).length
      this.say(
        [
          `${count('done')} of ${run.items.length} ads created`,
          count('processing') && `${count('processing')} videos still processing on Facebook`,
          count('queued') && `${count('queued')} waiting to upload again`,
          count('failed') && `${count('failed')} failed`,
        ]
          .filter(Boolean)
          .join(' · '),
      )
      await this.wait(TICK_MS)
    }
  }

  private async finish() {
    const { run } = this
    // one last look for ads that were asked for and never confirmed
    if (run.fbCampaignId && run.items.some((item) => item.checkAds && item.state !== 'done')) {
      this.say('Checking which ads exist…')
      await this.matchAds().catch(() => undefined)
    }
    const why = this.stopping ? 'Stopped before its ad was created' : (run.error ?? 'The launch ended before its ad was created')
    for (const item of run.items) {
      if (finished(item)) continue
      const stage = item.state === 'processing' ? 'processing' : item.kind === 'image' || item.fbVideoId ? 'ad-creation' : 'upload'
      const detail = item.state === 'processing' ? `${why}. The video is in the ad account's library and was still processing.` : why
      this.fail(item, item.error ? `${detail} (${item.error})` : detail, stage)
    }
    for (const step of Object.keys(run.steps) as Step[]) {
      if (run.steps[step] === 'active') run.steps[step] = 'error'
    }
    if (run.fbAdSetId) run.steps.ads = run.items.some((item) => item.state === 'done') ? 'done' : 'error'
    if (this.stopping && !run.error) run.error = 'Stopped.'
    run.phase = 'finished'
    run.activity = ''
    this.publish()
    await this.record(true)
  }

  // Writes what exists on Facebook to the campaign record. The campaign becomes
  // Launched only once it has an ad; until then the ids are noted and it stays Preparing.
  async record(final: boolean) {
    const { run } = this
    const { plan } = run
    if (!run.fbCampaignId) return
    run.record = { state: 'saving', launched: run.record.launched }
    this.publish()
    const ids = (kind: LaunchItem['kind']) => run.items.filter((item) => item.kind === kind && item.state === 'done' && item.adId).map((item) => item.id)
    const launchProfileId = plan.token.kind === 'profile' ? plan.token.recordId : ''
    const launchedData = JSON.stringify(snapshot(run))
    try {
      if (final && run.items.some((item) => item.state === 'done')) {
        // AI videos go in their own list: they live in another table
        const media = { videoIds: ids('video'), aiVideoIds: ids('ai'), imageIds: ids('image') }
        await api(`/campaigns/${plan.campaignId}/launch-result`, {
          method: 'POST',
          body: { fbCampaignId: run.fbCampaignId, fbAdAccountId: plan.adAccount.id, launchProfileId, launchedData, ...media },
        })
        run.record = { state: 'saved', launched: true }
        // until now the links held the draft's selection; from here they are the media that has an ad
        await api(`/data/campaigns/${plan.campaignId}`, {
          method: 'PATCH',
          body: {
            fields: {
              'Videos Used In This Campaign': media.videoIds,
              'Videos copy': media.aiVideoIds,
              'Images Used In This Campaign': media.imageIds,
            },
          },
        }).catch(() => undefined)
      } else {
        await api(`/data/campaigns/${plan.campaignId}`, {
          method: 'PATCH',
          body: {
            fields: {
              'FB Campaign ID': run.fbCampaignId,
              'FB Ad Account ID': plan.adAccount.id,
              'Launch Profile ID': launchProfileId,
              'Launched Data': launchedData,
            },
          },
        })
        run.record = { state: 'saved', launched: run.record.launched }
      }
    } catch (err) {
      run.record = { state: 'failed', error: message(err), launched: run.record.launched }
    }
    this.publish()
  }

  // Sends the failed items round again, into the campaign and ad set that exist:
  // all of them, or only the one named
  retry(itemId?: string) {
    const { run } = this
    // without a campaign there is nothing to add to; that is a new launch, started from the form
    if (this.busy || run.phase !== 'finished' || !run.fbCampaignId) return
    for (const item of run.items) {
      if (item.state !== 'failed' || (itemId !== undefined && item.id !== itemId)) continue
      item.uploads = 0
      item.attempts = 0
      item.lookups = 0
      item.error = undefined
      item.failedAt = undefined
      if (item.kind !== 'image' && !item.fbVideoId) {
        item.state = 'queued'
        item.checkLibrary = true
      } else {
        item.state = item.kind === 'image' || item.thumbnailUrl ? 'ready' : 'processing'
      }
      // whatever the earlier try left behind is found before anything is asked for again
      item.checkAds = true
    }
    for (const step of Object.keys(run.steps) as Step[]) {
      if (run.steps[step] === 'error') run.steps[step] = 'pending'
    }
    void this.drive()
  }

  get idle() {
    return !this.busy
  }
}

export function startLaunch(plan: LaunchPlan) {
  const current = runs.get(plan.campaignId)
  // one launch per campaign at a time
  if (current && current.phase !== 'finished') return
  const runner = new Runner({
    plan,
    phase: 'running',
    steps: { library: 'pending', upload: 'pending', campaign: 'pending', adSet: 'pending', ads: 'pending' },
    activity: 'Starting…',
    items: plan.media.map((media) => ({
      ...media,
      // an image is not uploaded: Facebook fetches it when the ad is made
      state: media.kind === 'image' ? 'ready' : 'queued',
      uploads: 0,
      attempts: 0,
      lookups: 0,
      checkLibrary: media.kind !== 'image' && plan.reuse,
      checkAds: false,
    })),
    record: { state: 'none', launched: false },
  })
  runners.set(plan.campaignId, runner)
  runner.publish()
  void runner.drive()
}

export const stopLaunch = (campaignId: string) => runners.get(campaignId)?.stop()
export const retryLaunch = (campaignId: string, itemId?: string) => runners.get(campaignId)?.retry(itemId)
export const retryRecord = (campaignId: string) => void runners.get(campaignId)?.record(true)

// Forgets a finished launch, so the launcher shows its form again
export function dismissLaunch(campaignId: string) {
  if (runs.get(campaignId)?.phase !== 'finished' || !runners.get(campaignId)?.idle) return
  runs.delete(campaignId)
  runners.delete(campaignId)
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

// The launch of this campaign started in this browser tab, if there is one
export const useLaunchRun = (campaignId: string) => useSyncExternalStore(subscribe, () => runs.get(campaignId))

// What exists on Facebook because of this launch, in plain sentences
export function onFacebook(run: LaunchRun): string[] {
  const { plan, items } = run
  const ads = items.filter((item) => item.state === 'done').length
  const orphans = new Set(items.filter((item) => item.kind !== 'image' && item.fbVideoId && item.state !== 'done').map((item) => item.fbVideoId)).size
  const lines: string[] = []
  if (run.fbCampaignId) {
    lines.push(`Campaign "${plan.name}" (${run.fbCampaignId}) in ${plan.adAccount.name} (${plan.adAccount.id}), ${plan.status === 'ACTIVE' ? 'active' : 'paused'}.`)
    lines.push(run.fbAdSetId ? `Ad set ${run.fbAdSetId}, with ${ads} ad${ads === 1 ? '' : 's'}.` : 'No ad set and no ads.')
  } else {
    lines.push('No campaign, ad set or ad was created.')
  }
  if (orphans) lines.push(`${orphans} video${orphans === 1 ? ' is' : 's are'} in the ad account's library without an ad.`)
  return lines
}

// Ads Manager, opened on the campaign
export const adsManagerUrl = (run: LaunchRun) =>
  `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${run.plan.adAccount.id.replace(/^act_/, '')}&selected_campaign_ids=${run.fbCampaignId}`
