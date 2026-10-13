import { Router } from 'express'
import { rows, sql } from '../lib/d1'
import { adAccount, graphId, type FacebookClient, type FbObject } from '../lib/facebook'
import { withCredential } from './credentials'

export const snapshotRouter = Router()

const CREATIVE_FIELDS = 'id,thumbnail_url,image_url,video_id,url_tags,object_story_spec,asset_feed_spec'

// unique, non-blank strings in first-seen order
function uniq(values: (string | undefined)[]) {
  const out: string[] = []
  for (const value of values) {
    const trimmed = value?.trim()
    if (trimmed && !out.includes(trimmed)) out.push(trimmed)
  }
  return out
}

const nameOf = async (client: FacebookClient, id: string) =>
  id ? client.get(id, { fields: 'name' }).then((o) => (o.name as string | undefined) ?? '', () => '') : ''

// GET /campaigns/{fbCampaignId}/import-snapshot?adAccountId=&cred=
// For a campaign launched outside the dashboard: reads it from Facebook and
// returns the same snapshot a real launch stores in `Launched Data`, flagged
// `importedFromFacebook` so the two can be told apart.
snapshotRouter.get('/campaigns/:id/import-snapshot', async (req, res) => {
  const campaignId = graphId(req.params.id, 'campaignId')
  const account = adAccount(String(req.query.adAccountId ?? ''))

  res.json(
    await withCredential(req.query.cred, async ({ kind, recordId, client }) => {
      const [campaign, adSets, ads, accountName, [profile], [linked]] = await Promise.all([
        client.get(campaignId, { fields: 'id,name,status,daily_budget,lifetime_budget,created_time' }),
        client.list(`${campaignId}/adsets`, {
          fields: 'id,name,status,daily_budget,lifetime_budget,start_time,promoted_object,targeting{geo_locations}',
          limit: 100,
        }),
        client.list(`${campaignId}/ads`, { fields: `id,name,creative{${CREATIVE_FIELDS}}`, limit: 100 }),
        nameOf(client, account.id),
        kind === 'profile' ? rows(sql('SELECT profile_name FROM profiles WHERE id = ?', recordId)) : Promise.resolve([]),
        rows(
          sql(
            `SELECT redtrack_campaign_id AS id, redtrack_campaign_name AS name FROM campaigns
             WHERE fb_campaign_id = ? AND redtrack_campaign_id != '' ORDER BY created_at DESC LIMIT 1`,
            campaignId,
          ),
        ),
      ])

      // a snapshot holds one ad set; an active one is preferred
      const adSet = adSets.find((s) => s.status === 'ACTIVE') ?? adSets[0]
      const creatives = ads.flatMap((ad) => (ad.creative ? [ad.creative as FbObject] : []))
      const first = creatives[0]
      const story = first?.object_story_spec
      const mediaData = story?.video_data ?? story?.link_data

      const pageId = uniq(creatives.map((c) => c.object_story_spec?.page_id))[0] ?? ''
      const pixelId: string = adSet?.promoted_object?.pixel_id ?? ''
      const [pageName, pixelName] = await Promise.all([nameOf(client, pageId), nameOf(client, pixelId)])

      // the budget sits on the campaign when Facebook manages it there, else on the ad set
      const budgetCents = parseInt(
        campaign.daily_budget || adSet?.daily_budget || campaign.lifetime_budget || adSet?.lifetime_budget || '0',
        10,
      )

      const copy = (feed: string, video: string, link: string) =>
        uniq(
          creatives.flatMap((c) => [
            ...((c.asset_feed_spec?.[feed] as { text: string }[] | undefined)?.map((entry) => entry.text) ?? []),
            c.object_story_spec?.video_data?.[video],
            c.object_story_spec?.link_data?.[link],
          ]),
        )
      const callToAction: string | undefined =
        mediaData?.call_to_action?.type ?? first?.asset_feed_spec?.call_to_action_types?.[0]
      const websiteUrl =
        uniq([mediaData?.call_to_action?.value?.link, story?.link_data?.link, first?.asset_feed_spec?.link_urls?.[0]?.website_url])[0] ?? ''

      // one media entry per ad
      const videos: FbObject[] = []
      const images: FbObject[] = []
      for (const ad of ads) {
        const c = ad.creative as FbObject | undefined
        const videoId = c?.object_story_spec?.video_data?.video_id ?? c?.video_id ?? c?.asset_feed_spec?.videos?.[0]?.video_id
        const entry = { localId: ad.id, name: ad.name, adId: ad.id, thumbnailUrl: c?.thumbnail_url }
        if (videoId) {
          videos.push({ ...entry, fbMediaId: videoId })
        } else {
          images.push({
            ...entry,
            fbMediaId: c?.object_story_spec?.link_data?.image_hash ?? c?.asset_feed_spec?.images?.[0]?.hash,
            imageUrl: c?.object_story_spec?.link_data?.picture ?? c?.image_url ?? c?.asset_feed_spec?.images?.[0]?.url ?? c?.thumbnail_url,
          })
        }
      }

      const start: string | undefined = adSet?.start_time
      return {
        version: 1,
        launchedAt: campaign.created_time,
        importedFromFacebook: true,
        config: {
          campaignName: campaign.name,
          budget: budgetCents / 100,
          budgetCents,
          geo: adSet?.targeting?.geo_locations?.countries ?? [],
          startDate: start?.slice(0, 10),
          startTime: start?.slice(11, 16),
          websiteUrl,
          utms: first?.url_tags || undefined,
          ctaOverride: callToAction,
          launchStatus: campaign.status === 'ACTIVE' ? 'ACTIVE' : 'PAUSED',
        },
        facebook: {
          adAccount: { id: account.id, name: accountName },
          page: { id: pageId, name: pageName },
          pixel: { id: pixelId, name: pixelName },
          campaign: { id: campaign.id, name: campaign.name },
          profile: { id: kind === 'profile' ? recordId : '', name: (profile?.profile_name as string | undefined) ?? '' },
          adSet: adSet ? { id: adSet.id, name: adSet.name } : undefined,
          adIds: ads.map((ad) => ad.id),
        },
        adPreset: {
          id: '',
          name: 'Imported from Facebook',
          primaryTexts: copy('bodies', 'message', 'message'),
          headlines: copy('titles', 'title', 'name'),
          descriptions: copy('descriptions', 'link_description', 'description'),
          callToAction,
        },
        redtrack: linked ? { campaignId: linked.id, campaignName: linked.name || undefined } : undefined,
        media: {
          summary: {
            videosAttempted: videos.length,
            videosSucceeded: videos.length,
            videosFailed: 0,
            imagesAttempted: images.length,
            imagesSucceeded: images.length,
            imagesFailed: 0,
          },
          videos: { succeeded: videos, failed: [] },
          images: { succeeded: images, failed: [] },
        },
        result: {
          success: true,
          partialSuccess: false,
          dryRun: false,
          adsAttempted: ads.length,
          adsCreated: ads.length,
          adsFailed: 0,
          completedAt: new Date().toISOString(),
          errors: [],
        },
      }
    }),
  )
})
