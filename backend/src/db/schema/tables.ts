import { index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { checkbox, id, parent, timestamps } from './columns'

export const users = sqliteTable(
  'users',
  {
    id: id(),
    name: text('name'),
    email: text('email'),
    // plaintext or PBKDF2 `base64(salt):base64(hash)`
    password: text('password'),
    role: text('role'),
    active: checkbox('active'),
    ...timestamps,
  },
  (t) => [index('idx_users_email').on(t.email)],
)

export const profiles = sqliteTable('profiles', {
  id: id(),
  // a Facebook user id on some rows, an AdsPower id on others
  profileId: text('profile_id'),
  profileName: text('profile_name'),
  profileStatus: text('profile_status'),
  permanentToken: text('permanent_token'),
  permanentTokenEndDate: text('permanent_token_end_date'),
  tokenValid: checkbox('token_valid'),
  lastSync: text('last_sync'),
  hidden: checkbox('hidden'),
  profileEmail: text('profile_email'),
  profileSecurityEmail: text('profile_security_email'),
  profileFbPassword: text('profile_fb_password'),
  profileEmailPassword: text('profile_email_password'),
  securityEmailPassword: text('security_email_password'),
  profile2fa: text('profile_2fa'),
  recoveryCode: text('recovery_code'),
  profileBirthDate: text('profile_birth_date'),
  profileReviewDate: text('profile_review_date'),
  profileGender: text('profile_gender'),
  profileLocation: text('profile_location'),
  profileLink: text('profile_link'),
  profileYearCreated: text('profile_year_created'),
  profileYoutubeHandle: text('profile_youtube_handle'),
  proxy: text('proxy'),
  profileFbUid: text('profile_fb_uid'),
  uid: text('uid'),
  linkedAdsProfile: text('linked_ads_profile'),
  // Profile Hub setup checklist
  recoveryCodes: text('recovery_codes'),
  extraNotes: text('extra_notes'),
  // JSON of the profile as first received; contains credentials
  originalData: text('original_data'),
  setupComplete: checkbox('setup_complete'),
  setupCompletedOn: text('setup_completed_on'),
  sop1AdspowerSetup: checkbox('sop_1_adspower_setup'),
  sop2InitialActivity: checkbox('sop_2_initial_activity'),
  sop3NewEmail: checkbox('sop_3_new_email'),
  sop4FacebookEmail: checkbox('sop_4_facebook_email'),
  sop5Password: checkbox('sop_5_password'),
  sop62faRecovery: checkbox('sop_6_2fa_recovery'),
  sop7BmAccess: checkbox('sop_7_bm_access'),
  sop8AssetsAssigned: checkbox('sop_8_assets_assigned'),
  sop9PageAccess: checkbox('sop_9_page_access'),
  ...timestamps,
})

// A hand-kept checklist per person; free text, not linked to the other tables
export const profileSetupSummary = sqliteTable('profile_setup_summary', {
  id: id(),
  person: text('person'),
  profileUid: text('profile_uid'),
  businessManagers: text('business_managers'),
  adAccounts: text('ad_accounts'),
  pages: text('pages'),
  pixels: text('pixels'),
  teamAccess: text('team_access'),
  setupStatus: text('setup_status'),
  toDo: text('to_do'),
  notes: text('notes'),
  ...timestamps,
})

export const businessManagers = sqliteTable(
  'business_managers',
  {
    id: id(),
    bmId: text('bm_id'),
    bmName: text('bm_name'),
    bmStatus: text('bm_status'),
    verificationStatus: text('verification_status'),
    // Facebook's creation time, not the row's
    bmCreatedTime: text('bm_created_time'),
    lastSynced: text('last_synced'),
    systemUserId: text('system_user_id'),
    systemUserToken: text('system_user_token'),
    systemUserCreated: text('system_user_created'),
    hidden: checkbox('hidden'),
    ...timestamps,
  },
  (t) => [index('idx_business_managers_bm_id').on(t.bmId)],
)

export const adAccounts = sqliteTable(
  'ad_accounts',
  {
    id: id(),
    // Facebook id without the `act_` prefix
    adAccId: text('ad_acc_id'),
    adAccName: text('ad_acc_name'),
    adAccStatus: text('ad_acc_status'),
    disableReason: text('disable_reason'),
    currency: text('currency'),
    accountType: text('account_type'),
    timezone: text('timezone'),
    usedInCampaigns: text('used_in_campaigns'),
    amountSpent: real('amount_spent'),
    lastSynced: text('last_synced'),
    hidden: checkbox('hidden'),
    ownerBmId: parent('owner_bm_id', () => businessManagers),
    ...timestamps,
  },
  (t) => [
    index('idx_ad_accounts_ad_acc_id').on(t.adAccId),
    index('idx_ad_accounts_owner_bm_id').on(t.ownerBmId),
  ],
)

export const pages = sqliteTable(
  'pages',
  {
    id: id(),
    pageId: text('page_id'),
    pageName: text('page_name'),
    published: text('published'),
    pageLink: text('page_link'),
    verificationStatus: text('verification_status'),
    usedInCampaigns: text('used_in_campaigns'),
    fanCount: integer('fan_count'),
    lastSynced: text('last_synced'),
    hidden: checkbox('hidden'),
    ...timestamps,
  },
  (t) => [index('idx_pages_page_id').on(t.pageId)],
)

export const pixels = sqliteTable(
  'pixels',
  {
    id: id(),
    pixelId: text('pixel_id'),
    pixelName: text('pixel_name'),
    available: text('available'),
    usedInCampaigns: text('used_in_campaigns'),
    lastFiredTime: text('last_fired_time'),
    creationTime: text('creation_time'),
    lastSynced: text('last_synced'),
    hidden: checkbox('hidden'),
    ownerBmId: parent('owner_bm_id', () => businessManagers),
    ...timestamps,
  },
  (t) => [
    index('idx_pixels_pixel_id').on(t.pixelId),
    index('idx_pixels_owner_bm_id').on(t.ownerBmId),
  ],
)

export const masterProfile = sqliteTable(
  'master_profile',
  {
    id: id(),
    name: text('name'),
    profileId: parent('profile_id', () => profiles),
    ...timestamps,
  },
  (t) => [index('idx_master_profile_profile_id').on(t.profileId)],
)

export const products = sqliteTable(
  'products',
  {
    id: id(),
    productName: text('product_name'),
    status: text('status'),
    driveLink: text('drive_link'),
    ...timestamps,
  },
  (t) => [index('idx_products_product_name').on(t.productName)],
)

export const advertorials = sqliteTable(
  'advertorials',
  {
    id: id(),
    advertorialName: text('advertorial_name'),
    productId: parent('product_id', () => products),
    advertorialText: text('advertorial_text'),
    finalAdvertorialLink: text('final_advertorial_link'),
    advertorialChecked: checkbox('advertorial_checked'),
    ...timestamps,
  },
  (t) => [index('idx_advertorials_product_id').on(t.productId)],
)

export const adPresets = sqliteTable(
  'ad_presets',
  {
    id: id(),
    presetName: text('preset_name'),
    productId: parent('product_id', () => products),
    primaryText1: text('primary_text_1'),
    primaryText2: text('primary_text_2'),
    primaryText3: text('primary_text_3'),
    primaryText4: text('primary_text_4'),
    primaryText5: text('primary_text_5'),
    headline1: text('headline_1'),
    headline2: text('headline_2'),
    headline3: text('headline_3'),
    headline4: text('headline_4'),
    headline5: text('headline_5'),
    description1: text('description_1'),
    description2: text('description_2'),
    description3: text('description_3'),
    description4: text('description_4'),
    description5: text('description_5'),
    callToAction: text('call_to_action'),
    beneficiaryName: text('beneficiary_name'),
    payerName: text('payer_name'),
    notes: text('notes'),
    ...timestamps,
  },
  (t) => [index('idx_ad_presets_product_id').on(t.productId)],
)

export const campaigns = sqliteTable(
  'campaigns',
  {
    id: id(),
    name: text('name'),
    productId: parent('product_id', () => products),
    status: text('status'),
    platform: text('platform'),
    funnelChecked: text('funnel_checked'),
    fbCampaignId: text('fb_campaign_id'),
    // Facebook ids, not record ids
    fbAdAccountId: text('fb_ad_account_id'),
    adAccUsed: text('ad_acc_used'),
    pageUsed: text('page_used'),
    pixelUsed: text('pixel_used'),
    // hold profiles.id values but can be '', so no foreign key
    launchProfileId: text('launch_profile_id'),
    profileId: text('profile_id'),
    redtrackCampaignId: text('redtrack_campaign_id'),
    redtrackCampaignName: text('redtrack_campaign_name'),
    tokenType: text('token_type'),
    locationTargeting: text('location_targeting'),
    websiteUrl: text('website_url'),
    utms: text('utms'),
    // HH:MM
    launchTime: text('launch_time'),
    displayLink: text('display_link'),
    cta: text('cta'),
    linkVariable: text('link_variable'),
    budget: real('budget'),
    launchDate: text('launch_date'),
    // when the launch actually finished; launch_date stays the planned time. Not in Airtable
    launchedAt: text('launched_at'),
    // usually a JSON snapshot, sometimes a plain sentence; never parsed here
    launchedData: text('launched_data'),
    reuseCreatives: checkbox('reuse_creatives'),
    launchAsActive: checkbox('launch_as_active'),
    // plain number fields in Airtable, not computed
    videoScriptsCount: integer('video_scripts_count'),
    videoCount: integer('video_count'),
    availableVideoCount: integer('available_video_count'),
    inProgressVideoCount: integer('in_progress_video_count'),
    selectedAdPresetId: parent('selected_ad_preset_id', () => adPresets),
    // holds a business_managers.id as plain text; not in Airtable
    systemUserBmId: text('system_user_bm_id'),
    ...timestamps,
  },
  (t) => [
    index('idx_campaigns_product_id_status').on(t.productId, t.status),
    index('idx_campaigns_status').on(t.status),
    index('idx_campaigns_fb_campaign_id').on(t.fbCampaignId),
    index('idx_campaigns_selected_ad_preset_id').on(t.selectedAdPresetId),
  ],
)

export const videoScripts = sqliteTable(
  'video_scripts',
  {
    id: id(),
    name: text('name'),
    productId: parent('product_id', () => products),
    authorId: parent('author_id', () => users),
    scriptContent: text('script_content'),
    hook: text('hook'),
    body: text('body'),
    notes: text('notes'),
    hookNumber: integer('hook_number'),
    baseScriptNumber: integer('base_script_number'),
    ...timestamps,
  },
  (t) => [
    index('idx_video_scripts_product_id').on(t.productId),
    index('idx_video_scripts_author_id').on(t.authorId),
  ],
)

export const videos = sqliteTable(
  'videos',
  {
    id: id(),
    videoName: text('video_name'),
    productId: parent('product_id', () => products),
    scriptId: parent('script_id', () => videoScripts),
    editorId: parent('editor_id', () => users),
    format: text('format'),
    textVersion: text('text_version'),
    status: text('status'),
    creativeLink: text('creative_link'),
    notes: text('notes'),
    scrollstopperNumber: integer('scrollstopper_number'),
    videoData: text('video_data'),
    firstUploadAt: text('first_upload_at'),
    // set whenever creative_link changes
    creativeLinkUpdatedAt: text('creative_link_updated_at'),
    ...timestamps,
  },
  (t) => [
    index('idx_videos_product_id_status').on(t.productId, t.status),
    // lets the per-script To Do / past To Do counts run from the index alone
    index('idx_videos_script_id_status').on(t.scriptId, t.status),
    index('idx_videos_editor_id_status').on(t.editorId, t.status),
    index('idx_videos_status').on(t.status),
  ],
)

export const aiVideos = sqliteTable(
  'ai_videos',
  {
    id: id(),
    videoName: text('video_name'),
    productId: parent('product_id', () => products),
    editorId: parent('editor_id', () => users),
    format: text('format'),
    status: text('status'),
    creativeLink: text('creative_link'),
    notes: text('notes'),
    videoData: text('video_data'),
    firstUploadAt: text('first_upload_at'),
    // set whenever creative_link changes
    creativeLinkUpdatedAt: text('creative_link_updated_at'),
    // plain text here, not a link to video_scripts
    script: text('script'),
    textVersion: text('text_version'),
    scrollstopperNumber: integer('scrollstopper_number'),
    choosenEditorsBestVideo: text('choosen_editors_best_video'),
    launchedCampaigns: text('launched_campaigns'),
    notes2Copy: text('notes_2_copy'),
    ...timestamps,
  },
  (t) => [
    index('idx_ai_videos_product_id_status').on(t.productId, t.status),
    index('idx_ai_videos_editor_id').on(t.editorId),
  ],
)

export const images = sqliteTable(
  'images',
  {
    id: id(),
    imageName: text('image_name'),
    productId: parent('product_id', () => products),
    imageDriveLink: text('image_drive_link'),
    prompt: text('prompt'),
    creator: text('creator'),
    launchedCampaigns: text('launched_campaigns'),
    count: integer('count'),
    ...timestamps,
  },
  // new images are numbered max(count) + 1 per product
  (t) => [index('idx_images_product_id_count').on(t.productId, t.count)],
)

export const tempImages = sqliteTable(
  'temp_images',
  {
    id: id(),
    name: text('name'),
    imageDriveLink: text('image_drive_link'),
    productId: parent('product_id', () => products),
    ...timestamps,
  },
  (t) => [index('idx_temp_images_product_id').on(t.productId)],
)

export const scalingRules = sqliteTable('scaling_rules', {
  id: id(),
  name: text('name'),
  ruleScope: text('rule_scope'),
  // Airtable's option names are misspelled (`Budget Chnage`); stored as spelled
  selectType: text('select_type'),
  checkAt: text('check_at'),
  ifCondition: text('if_condition'),
  thenAction: text('then_action'),
  executeActionAt: text('execute_action_at'),
  ...timestamps,
})

export const schedule = sqliteTable(
  'schedule',
  {
    id: id(),
    fbCampaignId: text('fb_campaign_id'),
    campaignId: parent('campaign_id', () => campaigns),
    fromRuleId: parent('from_rule_id', () => scalingRules),
    source: text('source'),
    type: text('type'),
    // a dollar amount as text, or ACTIVE / PAUSED
    execute: text('execute'),
    scheduledAt: text('scheduled_at'),
    status: text('status'),
    executedAt: text('executed_at'),
    response: text('response'),
    // set whenever response changes
    responseUpdatedAt: text('response_updated_at'),
    ...timestamps,
  },
  (t) => [
    index('idx_schedule_status_scheduled_at').on(t.status, t.scheduledAt),
    index('idx_schedule_status_executed_at').on(t.status, t.executedAt),
    index('idx_schedule_campaign_id').on(t.campaignId),
    index('idx_schedule_from_rule_id').on(t.fromRuleId),
  ],
)

export const ruleExecutionLog = sqliteTable(
  'rule_execution_log',
  {
    id: id(),
    // the rule's name at execution time
    ruleName: text('rule_name'),
    ruleId: parent('rule_id', () => scalingRules),
    executedAt: text('executed_at'),
    campaignsEvaluated: integer('campaigns_evaluated'),
    campaignsMatched: integer('campaigns_matched'),
    durationMs: integer('duration_ms'),
    actionsTaken: text('actions_taken'),
    status: text('status'),
    error: text('error'),
    ...timestamps,
  },
  (t) => [index('idx_rule_execution_log_rule_id_executed_at').on(t.ruleId, t.executedAt)],
)

export const campaignLaunchSetup = sqliteTable(
  'campaign_launch_setup',
  {
    id: id(),
    name: text('name'),
    productId: parent('product_id', () => products),
    count: integer('count'),
    // free text: a Facebook id or a name
    adAccount: text('ad_account'),
    pixel: text('pixel'),
    page: text('page'),
    callToAction: text('call_to_action'),
    targeting: text('targeting'),
    amount: text('amount'),
    ...timestamps,
  },
  (t) => [index('idx_campaign_launch_setup_product_id').on(t.productId)],
)

export const agents = sqliteTable('agents', {
  id: id(),
  name: text('name'),
  systemPrompt: text('system_prompt'),
  assignedPage: text('assigned_page'),
  maxTurns: integer('max_turns'),
  temperature: real('temperature'),
  outputFormat: text('output_format'),
  enabledTools: text('enabled_tools', { mode: 'json' }).$type<string[]>(),
  ...timestamps,
})

export const angles = sqliteTable(
  'angles',
  {
    id: id(),
    name: text('name'),
    productId: parent('product_id', () => products),
    isActive: checkbox('is_active'),
    ...timestamps,
  },
  (t) => [index('idx_angles_product_id').on(t.productId)],
)
