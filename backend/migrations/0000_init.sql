CREATE TABLE `ad_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`ad_acc_id` text,
	`ad_acc_name` text,
	`ad_acc_status` text,
	`disable_reason` text,
	`currency` text,
	`account_type` text,
	`timezone` text,
	`used_in_campaigns` text,
	`amount_spent` real,
	`last_synced` text,
	`hidden` integer DEFAULT false NOT NULL,
	`owner_bm_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_bm_id`) REFERENCES `business_managers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_ad_accounts_ad_acc_id` ON `ad_accounts` (`ad_acc_id`);--> statement-breakpoint
CREATE INDEX `idx_ad_accounts_owner_bm_id` ON `ad_accounts` (`owner_bm_id`);--> statement-breakpoint
CREATE TABLE `ad_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`preset_name` text,
	`product_id` text,
	`primary_text_1` text,
	`primary_text_2` text,
	`primary_text_3` text,
	`primary_text_4` text,
	`primary_text_5` text,
	`headline_1` text,
	`headline_2` text,
	`headline_3` text,
	`headline_4` text,
	`headline_5` text,
	`description_1` text,
	`description_2` text,
	`description_3` text,
	`description_4` text,
	`description_5` text,
	`call_to_action` text,
	`beneficiary_name` text,
	`payer_name` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_ad_presets_product_id` ON `ad_presets` (`product_id`);--> statement-breakpoint
CREATE TABLE `advertorials` (
	`id` text PRIMARY KEY NOT NULL,
	`advertorial_name` text,
	`product_id` text,
	`advertorial_text` text,
	`final_advertorial_link` text,
	`advertorial_checked` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_advertorials_product_id` ON `advertorials` (`product_id`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`system_prompt` text,
	`assigned_page` text,
	`max_turns` integer,
	`temperature` real,
	`output_format` text,
	`enabled_tools` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_videos` (
	`id` text PRIMARY KEY NOT NULL,
	`video_name` text,
	`product_id` text,
	`editor_id` text,
	`format` text,
	`status` text,
	`creative_link` text,
	`notes` text,
	`video_data` text,
	`first_upload_at` text,
	`creative_link_updated_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`editor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_ai_videos_product_id_status` ON `ai_videos` (`product_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_ai_videos_editor_id` ON `ai_videos` (`editor_id`);--> statement-breakpoint
CREATE TABLE `angles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`product_id` text,
	`is_active` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_angles_product_id` ON `angles` (`product_id`);--> statement-breakpoint
CREATE TABLE `business_managers` (
	`id` text PRIMARY KEY NOT NULL,
	`bm_id` text,
	`bm_name` text,
	`bm_status` text,
	`verification_status` text,
	`bm_created_time` text,
	`last_synced` text,
	`system_user_id` text,
	`system_user_token` text,
	`system_user_created` text,
	`hidden` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_business_managers_bm_id` ON `business_managers` (`bm_id`);--> statement-breakpoint
CREATE TABLE `campaign_launch_setup` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`product_id` text,
	`count` integer,
	`ad_account` text,
	`pixel` text,
	`page` text,
	`call_to_action` text,
	`targeting` text,
	`amount` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_campaign_launch_setup_product_id` ON `campaign_launch_setup` (`product_id`);--> statement-breakpoint
CREATE TABLE `campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`product_id` text,
	`status` text,
	`platform` text,
	`funnel_checked` text,
	`fb_campaign_id` text,
	`fb_ad_account_id` text,
	`ad_acc_used` text,
	`page_used` text,
	`pixel_used` text,
	`launch_profile_id` text,
	`profile_id` text,
	`redtrack_campaign_id` text,
	`redtrack_campaign_name` text,
	`token_type` text,
	`location_targeting` text,
	`website_url` text,
	`utms` text,
	`launch_time` text,
	`display_link` text,
	`cta` text,
	`link_variable` text,
	`budget` real,
	`launch_date` text,
	`launched_data` text,
	`reuse_creatives` integer DEFAULT false NOT NULL,
	`launch_as_active` integer DEFAULT false NOT NULL,
	`video_scripts_count` integer,
	`video_count` integer,
	`available_video_count` integer,
	`in_progress_video_count` integer,
	`selected_ad_preset_id` text,
	`system_user_bm_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`selected_ad_preset_id`) REFERENCES `ad_presets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_campaigns_product_id_status` ON `campaigns` (`product_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_campaigns_status` ON `campaigns` (`status`);--> statement-breakpoint
CREATE INDEX `idx_campaigns_fb_campaign_id` ON `campaigns` (`fb_campaign_id`);--> statement-breakpoint
CREATE INDEX `idx_campaigns_selected_ad_preset_id` ON `campaigns` (`selected_ad_preset_id`);--> statement-breakpoint
CREATE TABLE `images` (
	`id` text PRIMARY KEY NOT NULL,
	`image_name` text,
	`product_id` text,
	`image_drive_link` text,
	`prompt` text,
	`creator` text,
	`launched_campaigns` text,
	`count` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_images_product_id_count` ON `images` (`product_id`,`count`);--> statement-breakpoint
CREATE TABLE `master_profile` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`profile_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_master_profile_profile_id` ON `master_profile` (`profile_id`);--> statement-breakpoint
CREATE TABLE `pages` (
	`id` text PRIMARY KEY NOT NULL,
	`page_id` text,
	`page_name` text,
	`published` text,
	`page_link` text,
	`verification_status` text,
	`used_in_campaigns` text,
	`fan_count` integer,
	`last_synced` text,
	`hidden` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pages_page_id` ON `pages` (`page_id`);--> statement-breakpoint
CREATE TABLE `pixels` (
	`id` text PRIMARY KEY NOT NULL,
	`pixel_id` text,
	`pixel_name` text,
	`available` text,
	`used_in_campaigns` text,
	`last_fired_time` text,
	`creation_time` text,
	`last_synced` text,
	`hidden` integer DEFAULT false NOT NULL,
	`owner_bm_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_bm_id`) REFERENCES `business_managers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_pixels_pixel_id` ON `pixels` (`pixel_id`);--> statement-breakpoint
CREATE INDEX `idx_pixels_owner_bm_id` ON `pixels` (`owner_bm_id`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`product_name` text,
	`status` text,
	`drive_link` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_products_product_name` ON `products` (`product_name`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text,
	`profile_name` text,
	`profile_status` text,
	`permanent_token` text,
	`permanent_token_end_date` text,
	`token_valid` integer DEFAULT false NOT NULL,
	`last_sync` text,
	`hidden` integer DEFAULT false NOT NULL,
	`profile_email` text,
	`profile_security_email` text,
	`profile_fb_password` text,
	`profile_email_password` text,
	`security_email_password` text,
	`profile_2fa` text,
	`recovery_code` text,
	`profile_birth_date` text,
	`profile_review_date` text,
	`profile_gender` text,
	`profile_location` text,
	`profile_link` text,
	`profile_year_created` text,
	`profile_youtube_handle` text,
	`proxy` text,
	`profile_fb_uid` text,
	`uid` text,
	`linked_ads_profile` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rule_execution_log` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_name` text,
	`rule_id` text,
	`executed_at` text,
	`campaigns_evaluated` integer,
	`campaigns_matched` integer,
	`duration_ms` integer,
	`actions_taken` text,
	`status` text,
	`error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `scaling_rules`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_rule_execution_log_rule_id_executed_at` ON `rule_execution_log` (`rule_id`,`executed_at`);--> statement-breakpoint
CREATE TABLE `scaling_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`rule_scope` text,
	`select_type` text,
	`check_at` text,
	`if_condition` text,
	`then_action` text,
	`execute_action_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`fb_campaign_id` text,
	`campaign_id` text,
	`from_rule_id` text,
	`source` text,
	`type` text,
	`execute` text,
	`scheduled_at` text,
	`status` text,
	`executed_at` text,
	`response` text,
	`response_updated_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`from_rule_id`) REFERENCES `scaling_rules`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_schedule_status_scheduled_at` ON `schedule` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE INDEX `idx_schedule_status_executed_at` ON `schedule` (`status`,`executed_at`);--> statement-breakpoint
CREATE INDEX `idx_schedule_campaign_id` ON `schedule` (`campaign_id`);--> statement-breakpoint
CREATE INDEX `idx_schedule_from_rule_id` ON `schedule` (`from_rule_id`);--> statement-breakpoint
CREATE TABLE `temp_images` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`image_drive_link` text,
	`product_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_temp_images_product_id` ON `temp_images` (`product_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`email` text,
	`password` text,
	`role` text,
	`active` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_users_email` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `video_scripts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`product_id` text,
	`author_id` text,
	`script_content` text,
	`hook` text,
	`body` text,
	`notes` text,
	`hook_number` integer,
	`base_script_number` integer,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_video_scripts_product_id` ON `video_scripts` (`product_id`);--> statement-breakpoint
CREATE INDEX `idx_video_scripts_author_id` ON `video_scripts` (`author_id`);--> statement-breakpoint
CREATE TABLE `videos` (
	`id` text PRIMARY KEY NOT NULL,
	`video_name` text,
	`product_id` text,
	`script_id` text,
	`editor_id` text,
	`format` text,
	`text_version` text,
	`status` text,
	`creative_link` text,
	`notes` text,
	`scrollstopper_number` integer,
	`video_data` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`script_id`) REFERENCES `video_scripts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`editor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_videos_product_id_status` ON `videos` (`product_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_videos_script_id_status` ON `videos` (`script_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_videos_editor_id_status` ON `videos` (`editor_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_videos_status` ON `videos` (`status`);--> statement-breakpoint
CREATE TABLE `angle_ad_presets` (
	`angle_id` text NOT NULL,
	`ad_preset_id` text NOT NULL,
	`position_in_angle` integer NOT NULL,
	`position_in_ad_preset` integer NOT NULL,
	PRIMARY KEY(`angle_id`, `ad_preset_id`),
	FOREIGN KEY (`angle_id`) REFERENCES `angles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ad_preset_id`) REFERENCES `ad_presets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_angle_ad_presets_ad_preset_id` ON `angle_ad_presets` (`ad_preset_id`);--> statement-breakpoint
CREATE TABLE `angle_advertorials` (
	`angle_id` text NOT NULL,
	`advertorial_id` text NOT NULL,
	`position_in_angle` integer NOT NULL,
	`position_in_advertorial` integer NOT NULL,
	PRIMARY KEY(`angle_id`, `advertorial_id`),
	FOREIGN KEY (`angle_id`) REFERENCES `angles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`advertorial_id`) REFERENCES `advertorials`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_angle_advertorials_advertorial_id` ON `angle_advertorials` (`advertorial_id`);--> statement-breakpoint
CREATE TABLE `angle_ai_videos` (
	`angle_id` text NOT NULL,
	`ai_video_id` text NOT NULL,
	`position_in_angle` integer NOT NULL,
	`position_in_ai_video` integer NOT NULL,
	PRIMARY KEY(`angle_id`, `ai_video_id`),
	FOREIGN KEY (`angle_id`) REFERENCES `angles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ai_video_id`) REFERENCES `ai_videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_angle_ai_videos_ai_video_id` ON `angle_ai_videos` (`ai_video_id`);--> statement-breakpoint
CREATE TABLE `angle_images` (
	`angle_id` text NOT NULL,
	`image_id` text NOT NULL,
	`position_in_angle` integer NOT NULL,
	`position_in_image` integer NOT NULL,
	PRIMARY KEY(`angle_id`, `image_id`),
	FOREIGN KEY (`angle_id`) REFERENCES `angles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_angle_images_image_id` ON `angle_images` (`image_id`);--> statement-breakpoint
CREATE TABLE `angle_temp_images` (
	`angle_id` text NOT NULL,
	`temp_image_id` text NOT NULL,
	`position_in_angle` integer NOT NULL,
	`position_in_temp_image` integer NOT NULL,
	PRIMARY KEY(`angle_id`, `temp_image_id`),
	FOREIGN KEY (`angle_id`) REFERENCES `angles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`temp_image_id`) REFERENCES `temp_images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_angle_temp_images_temp_image_id` ON `angle_temp_images` (`temp_image_id`);--> statement-breakpoint
CREATE TABLE `angle_video_scripts` (
	`angle_id` text NOT NULL,
	`video_script_id` text NOT NULL,
	`position_in_angle` integer NOT NULL,
	`position_in_video_script` integer NOT NULL,
	PRIMARY KEY(`angle_id`, `video_script_id`),
	FOREIGN KEY (`angle_id`) REFERENCES `angles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`video_script_id`) REFERENCES `video_scripts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_angle_video_scripts_video_script_id` ON `angle_video_scripts` (`video_script_id`);--> statement-breakpoint
CREATE TABLE `angle_videos` (
	`angle_id` text NOT NULL,
	`video_id` text NOT NULL,
	`position_in_angle` integer NOT NULL,
	`position_in_video` integer NOT NULL,
	PRIMARY KEY(`angle_id`, `video_id`),
	FOREIGN KEY (`angle_id`) REFERENCES `angles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_angle_videos_video_id` ON `angle_videos` (`video_id`);--> statement-breakpoint
CREATE TABLE `business_manager_ad_accounts` (
	`business_manager_id` text NOT NULL,
	`ad_account_id` text NOT NULL,
	`position_in_business_manager` integer NOT NULL,
	`position_in_ad_account` integer NOT NULL,
	PRIMARY KEY(`business_manager_id`, `ad_account_id`),
	FOREIGN KEY (`business_manager_id`) REFERENCES `business_managers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ad_account_id`) REFERENCES `ad_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_business_manager_ad_accounts_ad_account_id` ON `business_manager_ad_accounts` (`ad_account_id`);--> statement-breakpoint
CREATE TABLE `business_manager_pixels` (
	`business_manager_id` text NOT NULL,
	`pixel_id` text NOT NULL,
	`position_in_business_manager` integer NOT NULL,
	`position_in_pixel` integer NOT NULL,
	PRIMARY KEY(`business_manager_id`, `pixel_id`),
	FOREIGN KEY (`business_manager_id`) REFERENCES `business_managers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pixel_id`) REFERENCES `pixels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_business_manager_pixels_pixel_id` ON `business_manager_pixels` (`pixel_id`);--> statement-breakpoint
CREATE TABLE `campaign_ai_videos` (
	`campaign_id` text NOT NULL,
	`ai_video_id` text NOT NULL,
	`position_in_campaign` integer NOT NULL,
	`position_in_ai_video` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `ai_video_id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ai_video_id`) REFERENCES `ai_videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_campaign_ai_videos_ai_video_id` ON `campaign_ai_videos` (`ai_video_id`);--> statement-breakpoint
CREATE TABLE `campaign_images` (
	`campaign_id` text NOT NULL,
	`image_id` text NOT NULL,
	`position_in_campaign` integer NOT NULL,
	`position_in_image` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `image_id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_id`) REFERENCES `images`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_campaign_images_image_id` ON `campaign_images` (`image_id`);--> statement-breakpoint
CREATE TABLE `campaign_videos` (
	`campaign_id` text NOT NULL,
	`video_id` text NOT NULL,
	`position_in_campaign` integer NOT NULL,
	`position_in_video` integer NOT NULL,
	PRIMARY KEY(`campaign_id`, `video_id`),
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_campaign_videos_video_id` ON `campaign_videos` (`video_id`);--> statement-breakpoint
CREATE TABLE `profile_business_managers` (
	`profile_id` text NOT NULL,
	`business_manager_id` text NOT NULL,
	`position_in_profile` integer NOT NULL,
	`position_in_business_manager` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `business_manager_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`business_manager_id`) REFERENCES `business_managers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_profile_business_managers_business_manager_id` ON `profile_business_managers` (`business_manager_id`);--> statement-breakpoint
CREATE TABLE `profile_pages` (
	`profile_id` text NOT NULL,
	`page_id` text NOT NULL,
	`position_in_profile` integer NOT NULL,
	`position_in_page` integer NOT NULL,
	PRIMARY KEY(`profile_id`, `page_id`),
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`page_id`) REFERENCES `pages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_profile_pages_page_id` ON `profile_pages` (`page_id`);--> statement-breakpoint
CREATE TABLE `scaling_rule_campaigns` (
	`scaling_rule_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`position_in_scaling_rule` integer NOT NULL,
	`position_in_campaign` integer NOT NULL,
	PRIMARY KEY(`scaling_rule_id`, `campaign_id`),
	FOREIGN KEY (`scaling_rule_id`) REFERENCES `scaling_rules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`campaign_id`) REFERENCES `campaigns`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_scaling_rule_campaigns_campaign_id` ON `scaling_rule_campaigns` (`campaign_id`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`table_name` text NOT NULL,
	`record_id` text NOT NULL,
	`field_name` text NOT NULL,
	`position` integer NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer,
	`width` integer,
	`height` integer,
	`r2_key` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_attachments_owner` ON `attachments` (`table_name`,`record_id`,`field_name`,`position`);