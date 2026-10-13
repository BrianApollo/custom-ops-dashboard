CREATE TABLE `profile_setup_summary` (
	`id` text PRIMARY KEY NOT NULL,
	`person` text,
	`profile_uid` text,
	`business_managers` text,
	`ad_accounts` text,
	`pages` text,
	`pixels` text,
	`team_access` text,
	`setup_status` text,
	`to_do` text,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `ai_videos` ADD `script` text;--> statement-breakpoint
ALTER TABLE `ai_videos` ADD `text_version` text;--> statement-breakpoint
ALTER TABLE `ai_videos` ADD `scrollstopper_number` integer;--> statement-breakpoint
ALTER TABLE `ai_videos` ADD `choosen_editors_best_video` text;--> statement-breakpoint
ALTER TABLE `ai_videos` ADD `launched_campaigns` text;--> statement-breakpoint
ALTER TABLE `ai_videos` ADD `notes_2_copy` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `recovery_codes` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `extra_notes` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `original_data` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `setup_complete` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `setup_completed_on` text;--> statement-breakpoint
ALTER TABLE `profiles` ADD `sop_1_adspower_setup` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `sop_2_initial_activity` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `sop_3_new_email` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `sop_4_facebook_email` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `sop_5_password` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `sop_6_2fa_recovery` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `sop_7_bm_access` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `sop_8_assets_assigned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `profiles` ADD `sop_9_page_access` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `videos` ADD `first_upload_at` text;--> statement-breakpoint
ALTER TABLE `videos` ADD `creative_link_updated_at` text;