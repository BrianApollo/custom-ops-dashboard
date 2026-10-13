import { Router } from 'express'
import { badRequest, invalid } from '../lib/errors'
import { adAccount, graphId, type BatchItem, type FbObject } from '../lib/facebook'
import { ownFile } from '../lib/storage'
import { withCredential } from './credentials'

// The steps of a campaign launch, one call each. The frontend's launch runner
// drives them in order; the profile launcher and the system user launcher use
// the same calls and differ only in `cred`. Every answer carries `rate`,
// Facebook's API usage as a percentage.
export const launchRouter = Router()

const MAX_UPLOAD = 10
const MAX_ADS = 25

const text = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !value.trim()) throw invalid(`${name} is required`, name)
  return value
}
const texts = (value: unknown, name: string) => {
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) throw invalid(`${name} must be a list of text`, name)
  return value as string[]
}
const launchStatus = (value: unknown, name: string) => {
  if (value !== 'ACTIVE' && value !== 'PAUSED') throw invalid(`${name} must be ACTIVE or PAUSED`, name)
  return value
}

// a form body for one call inside a batch, each value encoded once
const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString()

// POST /ad-accounts/{id}/campaigns { cred, campaign }
launchRouter.post('/ad-accounts/:id/campaigns', async (req, res) => {
  const { id } = adAccount(req.params.id)
  const c = req.body?.campaign ?? {}
  if (!Number.isInteger(c.dailyBudget) || c.dailyBudget <= 0) {
    throw invalid('campaign.dailyBudget must be a positive whole number of cents', 'campaign.dailyBudget')
  }
  const params = {
    name: text(c.name, 'campaign.name'),
    objective: text(c.objective, 'campaign.objective'),
    status: launchStatus(c.status, 'campaign.status'),
    special_ad_categories: texts(c.specialAdCategories ?? [], 'campaign.specialAdCategories'),
    daily_budget: String(c.dailyBudget),
    bid_strategy: text(c.bidStrategy, 'campaign.bidStrategy'),
  }
  res.json(
    await withCredential(req.body?.cred, async ({ client }) => {
      const created = await client.post(`${id}/campaigns`, params)
      return { id: created.id, rate: client.rate }
    }),
  )
})

// POST /ad-accounts/{id}/adsets { cred, campaignId, pixelId, adSet }
launchRouter.post('/ad-accounts/:id/adsets', async (req, res) => {
  const { id } = adAccount(req.params.id)
  const body = req.body ?? {}
  const a = body.adSet ?? {}
  const countries = texts(a.targeting?.geoLocations?.countries, 'adSet.targeting.geoLocations.countries').map((c) => c.toUpperCase())
  if (!countries.length) throw invalid('At least one country is required', 'adSet.targeting.geoLocations.countries')
  // Europe's ad rules need a named beneficiary and payer on every ad set
  const beneficiary = a.beneficiaryName || 'Online Marketing'

  const params: Record<string, unknown> = {
    name: text(a.name, 'adSet.name'),
    campaign_id: graphId(body.campaignId, 'campaignId'),
    optimization_goal: text(a.optimizationGoal, 'adSet.optimizationGoal'),
    billing_event: text(a.billingEvent, 'adSet.billingEvent'),
    status: launchStatus(a.status, 'adSet.status'),
    targeting: { geo_locations: { countries }, age_min: a.targeting?.ageMin ?? 18, age_max: a.targeting?.ageMax ?? 65 },
    promoted_object: {
      pixel_id: graphId(body.pixelId, 'pixelId'),
      custom_event_type: text(a.promotedObject?.customEventType, 'adSet.promotedObject.customEventType'),
    },
    // Unix seconds; with none given the ad set starts in an hour
    start_time: String(a.startTime || Math.floor(Date.now() / 1000) + 3600),
    dsa_beneficiary: beneficiary,
    dsa_payor: a.payerName || beneficiary,
  }
  if (countries.includes('SG')) params.regional_regulated_categories = ['SINGAPORE_UNIVERSAL']

  res.json(
    await withCredential(body.cred, async ({ client }) => {
      const created = await client.post(`${id}/adsets`, params)
      return { id: created.id, rate: client.rate }
    }),
  )
})

const videoState = (video: FbObject) => ({
  id: video.id as string,
  title: video.title as string | undefined,
  status: video.status?.video_status as string | undefined,
  picture: (video.picture as string | undefined) ?? null,
})

// POST /ad-accounts/{id}/videos/check { cred, names }
// Finds videos already in the ad account's library by title, so they need not
// be uploaded again. Facebook cannot search by title, so pages are read until
// every name has turned up.
launchRouter.post('/ad-accounts/:id/videos/check', async (req, res) => {
  const { id } = adAccount(req.params.id)
  const names = new Set(texts(req.body?.names, 'names'))
  res.json(
    await withCredential(req.body?.cred, async ({ client }) => {
      const found: ReturnType<typeof videoState>[] = []
      const seen = new Set<string>()
      let after: string | undefined
      for (let page = 0; page < 100 && seen.size < names.size; page++) {
        const body = await client.get(`${id}/advideos`, { fields: 'id,title,status,picture', limit: 100, ...(after ? { after } : {}) })
        for (const video of (body.data as FbObject[] | undefined) ?? []) {
          if (video.title && names.has(video.title)) {
            found.push(videoState(video))
            seen.add(video.title)
          }
        }
        after = body.paging?.next ? body.paging.cursors?.after : undefined
        if (!after) break
      }
      return { results: found, rate: client.rate }
    }),
  )
})

// POST /ad-accounts/{id}/videos/upload { cred, videos: [{ name, url }] }
// Facebook downloads each file itself. The video's title is its name, which is
// how it is found again later. A video Facebook could not fetch is tried once
// more from the bucket's r2.dev address.
launchRouter.post('/ad-accounts/:id/videos/upload', async (req, res) => {
  const { id } = adAccount(req.params.id)
  const videos = req.body?.videos
  if (!Array.isArray(videos) || videos.length === 0 || videos.length > MAX_UPLOAD) {
    throw badRequest(`videos must be a list of 1 to ${MAX_UPLOAD}`)
  }
  const items = videos.map((video, i) => ({ name: text(video?.name, `videos[${i}].name`), ...ownFile(video?.url, `videos[${i}].url`) }))

  res.json(
    await withCredential(req.body?.cred, async ({ client }) => {
      const send = (list: { name: string; url: string }[]) =>
        client.batch(
          list.map(
            (video): BatchItem => ({
              method: 'POST',
              relative_url: `${id}/advideos`,
              body: form({ file_url: video.url, title: video.name }),
            }),
          ),
        )
      const first = await send(items)
      const results = items.map((video, i) => ({
        name: video.name,
        success: Boolean(first[i]?.body?.id),
        fbVideoId: (first[i]?.body?.id as string | undefined) ?? null,
        error: first[i]?.body?.id ? null : (first[i]?.error ?? 'Facebook returned no video id'),
      }))

      const retry = items.flatMap((video, i) => (!results[i].success && video.fallback ? [{ i, name: video.name, url: video.fallback }] : []))
      if (retry.length) {
        const second = await send(retry)
        retry.forEach(({ i }, n) => {
          const fbVideoId = second[n]?.body?.id as string | undefined
          if (fbVideoId) results[i] = { ...results[i], success: true, fbVideoId, error: null }
        })
      }
      return { results, rate: client.rate }
    }),
  )
})

// POST /ad-accounts/{id}/videos/status { cred, videoIds }
launchRouter.post('/ad-accounts/:id/videos/status', async (req, res) => {
  const { id } = adAccount(req.params.id)
  const videoIds = texts(req.body?.videoIds, 'videoIds').map((v) => graphId(v, 'videoIds'))
  if (!videoIds.length) throw badRequest('videoIds must not be empty')
  res.json(
    await withCredential(req.body?.cred, async ({ client }) => {
      const videos = await client.list(`${id}/advideos`, {
        fields: 'id,status,picture',
        filtering: [{ field: 'id', operator: 'IN', value: videoIds }],
        limit: 100,
      })
      return { results: videos.map(videoState), rate: client.rate }
    }),
  )
})

// POST /ad-accounts/{id}/ads { cred, adSetId, pageId, adCreative, media }
// One ad per media item, each with its own creative. An item counts as done
// only when Facebook returns an ad id for it.
launchRouter.post('/ad-accounts/:id/ads', async (req, res) => {
  const { id } = adAccount(req.params.id)
  const body = req.body ?? {}
  const adSetId = graphId(body.adSetId, 'adSetId')
  const pageId = graphId(body.pageId, 'pageId')
  const c = body.adCreative ?? {}
  const media = body.media
  if (!Array.isArray(media) || media.length === 0 || media.length > MAX_ADS) {
    throw badRequest(`media must be a list of 1 to ${MAX_ADS}`)
  }
  const status = c.status === undefined ? 'PAUSED' : launchStatus(c.status, 'adCreative.status')
  const callToAction = { type: text(c.callToAction, 'adCreative.callToAction'), value: { link: text(c.websiteUrl, 'adCreative.websiteUrl') } }
  const shared = {
    url_tags: typeof c.urlTags === 'string' ? c.urlTags : '',
    asset_feed_spec: {
      bodies: texts(c.bodies, 'adCreative.bodies').map((t) => ({ text: t })),
      titles: texts(c.titles, 'adCreative.titles').map((t) => ({ text: t })),
      descriptions: texts(c.descriptions, 'adCreative.descriptions').map((t) => ({ text: t })),
      optimization_type: 'DEGREES_OF_FREEDOM',
    },
    degrees_of_freedom_spec: {
      creative_features_spec: { advantage_plus_creative: { enroll_status: c.advantagePlusCreative === false ? 'OPT_OUT' : 'OPT_IN' } },
    },
  }

  const items = media.map((item, i): { name: string; body: string } => {
    const name = text(item?.name, `media[${i}].name`)
    const story =
      item.type === 'video'
        ? {
            video_data: {
              video_id: graphId(item.fbVideoId, `media[${i}].fbVideoId`),
              image_url: text(item.thumbnailUrl, `media[${i}].thumbnailUrl`),
              call_to_action: callToAction,
            },
          }
        : item.type === 'image'
          ? // an image is not uploaded first; Facebook fetches it from our storage
            { link_data: { picture: ownFile(item.url, `media[${i}].url`).url, link: callToAction.value.link, call_to_action: callToAction } }
          : null
    if (!story) throw invalid(`media[${i}].type must be video or image`, `media[${i}].type`)
    const creative = { name: `Creative-${name}`, object_story_spec: { page_id: pageId, ...story }, ...shared }
    return { name, body: form({ name: `Ad-${name}`, adset_id: adSetId, status, creative: JSON.stringify(creative) }) }
  })

  res.json(
    await withCredential(body.cred, async ({ client }) => {
      const created = await client.batch(items.map((item): BatchItem => ({ method: 'POST', relative_url: `${id}/ads`, body: item.body })))
      return {
        results: items.map((item, i) => {
          const adId = created[i]?.body?.id as string | undefined
          return { name: item.name, success: Boolean(adId), adId: adId ?? null, error: adId ? null : (created[i]?.error ?? 'Facebook returned no ad id') }
        }),
        rate: client.rate,
      }
    }),
  )
})
