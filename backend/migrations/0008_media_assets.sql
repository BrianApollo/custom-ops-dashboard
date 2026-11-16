CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_key` text NOT NULL,
	`product_id` text,
	`generic` integer DEFAULT false NOT NULL,
	`niche` text NOT NULL,
	`kind` text NOT NULL,
	`phase` text,
	`product_visible` integer,
	`text_overlay` integer,
	`subject` text,
	`orientation` text,
	`aspect` text,
	`width` integer,
	`height` integer,
	`duration_ms` integer,
	`max_use_ms` integer,
	`source_system` text NOT NULL,
	`source_id` text NOT NULL,
	`source_video_id` text,
	`rights` text NOT NULL,
	`storage_key` text,
	`hash` text NOT NULL,
	`bytes` integer,
	`tag_source` text NOT NULL,
	`tag_confidence` real,
	`approved` integer DEFAULT false NOT NULL,
	`used_in` text DEFAULT '[]' NOT NULL,
	`notes` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_hash` ON `media_assets` (`hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_key` ON `media_assets` (`asset_key`);--> statement-breakpoint
CREATE INDEX `media_assets_menu` ON `media_assets` (`product_id`,`phase`,`product_visible`,`kind`,`approved`);