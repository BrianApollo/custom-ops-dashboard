CREATE TABLE `media_asset_tags` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`tag_key` text NOT NULL,
	`value` text NOT NULL,
	`source` text,
	`confidence` real,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_asset_tags_value` ON `media_asset_tags` (`asset_id`,`tag_key`,`value`);--> statement-breakpoint
CREATE INDEX `media_asset_tags_filter` ON `media_asset_tags` (`tag_key`,`value`);--> statement-breakpoint
CREATE TABLE `tag_types` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	`allowed_values` text,
	`multi` integer DEFAULT false NOT NULL,
	`filter` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_types_key` ON `tag_types` (`key`);--> statement-breakpoint
ALTER TABLE `media_assets` ADD `tag_version` integer;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `generation` text;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `parent_asset_id` text REFERENCES media_assets(id) ON DELETE set null;