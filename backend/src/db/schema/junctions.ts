import { index, primaryKey, sqliteTable } from 'drizzle-orm/sqlite-core'
import { link, position } from './columns'
import {
  adAccounts,
  adPresets,
  advertorials,
  aiVideos,
  angles,
  businessManagers,
  campaigns,
  images,
  pages,
  pixels,
  profiles,
  scalingRules,
  tempImages,
  videoScripts,
  videos,
} from './tables'

// Each Airtable link is stored once. The two position columns keep the array
// order Airtable shows on each side of the link.

export const profileBusinessManagers = sqliteTable(
  'profile_business_managers',
  {
    profileId: link('profile_id', () => profiles),
    businessManagerId: link('business_manager_id', () => businessManagers),
    positionInProfile: position('position_in_profile'),
    positionInBusinessManager: position('position_in_business_manager'),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.businessManagerId] }),
    index('idx_profile_business_managers_business_manager_id').on(t.businessManagerId),
  ],
)

export const profilePages = sqliteTable(
  'profile_pages',
  {
    profileId: link('profile_id', () => profiles),
    pageId: link('page_id', () => pages),
    positionInProfile: position('position_in_profile'),
    positionInPage: position('position_in_page'),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.pageId] }),
    index('idx_profile_pages_page_id').on(t.pageId),
  ],
)

export const businessManagerAdAccounts = sqliteTable(
  'business_manager_ad_accounts',
  {
    businessManagerId: link('business_manager_id', () => businessManagers),
    adAccountId: link('ad_account_id', () => adAccounts),
    positionInBusinessManager: position('position_in_business_manager'),
    positionInAdAccount: position('position_in_ad_account'),
  },
  (t) => [
    primaryKey({ columns: [t.businessManagerId, t.adAccountId] }),
    index('idx_business_manager_ad_accounts_ad_account_id').on(t.adAccountId),
  ],
)

export const businessManagerPixels = sqliteTable(
  'business_manager_pixels',
  {
    businessManagerId: link('business_manager_id', () => businessManagers),
    pixelId: link('pixel_id', () => pixels),
    positionInBusinessManager: position('position_in_business_manager'),
    positionInPixel: position('position_in_pixel'),
  },
  (t) => [
    primaryKey({ columns: [t.businessManagerId, t.pixelId] }),
    index('idx_business_manager_pixels_pixel_id').on(t.pixelId),
  ],
)

export const campaignVideos = sqliteTable(
  'campaign_videos',
  {
    campaignId: link('campaign_id', () => campaigns),
    videoId: link('video_id', () => videos),
    positionInCampaign: position('position_in_campaign'),
    positionInVideo: position('position_in_video'),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.videoId] }),
    index('idx_campaign_videos_video_id').on(t.videoId),
  ],
)

export const campaignAiVideos = sqliteTable(
  'campaign_ai_videos',
  {
    campaignId: link('campaign_id', () => campaigns),
    aiVideoId: link('ai_video_id', () => aiVideos),
    positionInCampaign: position('position_in_campaign'),
    positionInAiVideo: position('position_in_ai_video'),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.aiVideoId] }),
    index('idx_campaign_ai_videos_ai_video_id').on(t.aiVideoId),
  ],
)

export const campaignImages = sqliteTable(
  'campaign_images',
  {
    campaignId: link('campaign_id', () => campaigns),
    imageId: link('image_id', () => images),
    positionInCampaign: position('position_in_campaign'),
    positionInImage: position('position_in_image'),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.imageId] }),
    index('idx_campaign_images_image_id').on(t.imageId),
  ],
)

export const scalingRuleCampaigns = sqliteTable(
  'scaling_rule_campaigns',
  {
    scalingRuleId: link('scaling_rule_id', () => scalingRules),
    campaignId: link('campaign_id', () => campaigns),
    positionInScalingRule: position('position_in_scaling_rule'),
    positionInCampaign: position('position_in_campaign'),
  },
  (t) => [
    primaryKey({ columns: [t.scalingRuleId, t.campaignId] }),
    index('idx_scaling_rule_campaigns_campaign_id').on(t.campaignId),
  ],
)

export const angleVideoScripts = sqliteTable(
  'angle_video_scripts',
  {
    angleId: link('angle_id', () => angles),
    videoScriptId: link('video_script_id', () => videoScripts),
    positionInAngle: position('position_in_angle'),
    positionInVideoScript: position('position_in_video_script'),
  },
  (t) => [
    primaryKey({ columns: [t.angleId, t.videoScriptId] }),
    index('idx_angle_video_scripts_video_script_id').on(t.videoScriptId),
  ],
)

export const angleVideos = sqliteTable(
  'angle_videos',
  {
    angleId: link('angle_id', () => angles),
    videoId: link('video_id', () => videos),
    positionInAngle: position('position_in_angle'),
    positionInVideo: position('position_in_video'),
  },
  (t) => [
    primaryKey({ columns: [t.angleId, t.videoId] }),
    index('idx_angle_videos_video_id').on(t.videoId),
  ],
)

export const angleAiVideos = sqliteTable(
  'angle_ai_videos',
  {
    angleId: link('angle_id', () => angles),
    aiVideoId: link('ai_video_id', () => aiVideos),
    positionInAngle: position('position_in_angle'),
    positionInAiVideo: position('position_in_ai_video'),
  },
  (t) => [
    primaryKey({ columns: [t.angleId, t.aiVideoId] }),
    index('idx_angle_ai_videos_ai_video_id').on(t.aiVideoId),
  ],
)

export const angleImages = sqliteTable(
  'angle_images',
  {
    angleId: link('angle_id', () => angles),
    imageId: link('image_id', () => images),
    positionInAngle: position('position_in_angle'),
    positionInImage: position('position_in_image'),
  },
  (t) => [
    primaryKey({ columns: [t.angleId, t.imageId] }),
    index('idx_angle_images_image_id').on(t.imageId),
  ],
)

export const angleTempImages = sqliteTable(
  'angle_temp_images',
  {
    angleId: link('angle_id', () => angles),
    tempImageId: link('temp_image_id', () => tempImages),
    positionInAngle: position('position_in_angle'),
    positionInTempImage: position('position_in_temp_image'),
  },
  (t) => [
    primaryKey({ columns: [t.angleId, t.tempImageId] }),
    index('idx_angle_temp_images_temp_image_id').on(t.tempImageId),
  ],
)

export const angleAdvertorials = sqliteTable(
  'angle_advertorials',
  {
    angleId: link('angle_id', () => angles),
    advertorialId: link('advertorial_id', () => advertorials),
    positionInAngle: position('position_in_angle'),
    positionInAdvertorial: position('position_in_advertorial'),
  },
  (t) => [
    primaryKey({ columns: [t.angleId, t.advertorialId] }),
    index('idx_angle_advertorials_advertorial_id').on(t.advertorialId),
  ],
)

export const angleAdPresets = sqliteTable(
  'angle_ad_presets',
  {
    angleId: link('angle_id', () => angles),
    adPresetId: link('ad_preset_id', () => adPresets),
    positionInAngle: position('position_in_angle'),
    positionInAdPreset: position('position_in_ad_preset'),
  },
  (t) => [
    primaryKey({ columns: [t.angleId, t.adPresetId] }),
    index('idx_angle_ad_presets_ad_preset_id').on(t.adPresetId),
  ],
)
