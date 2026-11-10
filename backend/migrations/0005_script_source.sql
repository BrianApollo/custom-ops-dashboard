ALTER TABLE `video_scripts` ADD `source` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
-- Scripts the Ad Lab upload made before this column existed: its names end in `- AdLab`
-- and its author is the Ad Lab user
UPDATE `video_scripts` SET `source` = 'automation'
WHERE `name` LIKE '% - AdLab'
   OR `author_id` IN (SELECT `id` FROM `users` WHERE `name` = 'Ad Lab');
