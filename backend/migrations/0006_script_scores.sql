CREATE TABLE `script_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`video_script_id` text NOT NULL,
	`product_id` text,
	`script_number` integer NOT NULL,
	`status` text NOT NULL,
	`spend` real NOT NULL,
	`purchases` real NOT NULL,
	`revenue` real NOT NULL,
	`roas_shrunk` real,
	`index_shrunk` real,
	`funded_share` real,
	`campaigns` integer,
	`campaigns_30d` integer,
	`fatigued` integer DEFAULT false NOT NULL,
	`overused` integer DEFAULT false NOT NULL,
	`rank_score` real,
	`first_day` text,
	`last_day` text,
	`computed_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`video_script_id`) REFERENCES `video_scripts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `script_scores_script` ON `script_scores` (`video_script_id`);--> statement-breakpoint
CREATE INDEX `script_scores_rank` ON `script_scores` (`product_id`,`status`,`rank_score`);--> statement-breakpoint
ALTER TABLE `video_scripts` ADD `script_source` text;--> statement-breakpoint
ALTER TABLE `video_scripts` ADD `donor_ref` text;--> statement-breakpoint
ALTER TABLE `video_scripts` ADD `hook_family` text;--> statement-breakpoint
ALTER TABLE `video_scripts` ADD `proof_type` text;--> statement-breakpoint
ALTER TABLE `video_scripts` ADD `structure` text;