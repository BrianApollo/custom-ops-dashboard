-- Airtable computed fields that the dashboard reads, rebuilt from stored columns.
-- One row per base-table row; join on the id column.

-- Video Scripts: `Videos`, `Scripts To Do`, `Scripts Past To Do`, `Calculation`, `Editor (from Videos)`
CREATE VIEW `video_scripts_computed` AS
SELECT
	s.`id` AS `video_script_id`,
	json_group_array(v.`id`) FILTER (WHERE v.`id` IS NOT NULL) AS `video_ids`,
	count(CASE WHEN v.`status` = 'To Do' THEN 1 END) AS `scripts_to_do`,
	count(CASE WHEN v.`status` != 'To Do' THEN 1 END) AS `scripts_past_to_do`,
	CAST(count(CASE WHEN v.`status` != 'To Do' THEN 1 END) AS REAL)
		/ nullif(count(v.`status`), 0) AS `calculation`,
	json_group_array(DISTINCT v.`editor_id`) FILTER (WHERE v.`editor_id` IS NOT NULL) AS `editor_ids`
FROM `video_scripts` s
LEFT JOIN `videos` v ON v.`script_id` = s.`id`
GROUP BY s.`id`;
--> statement-breakpoint
-- Videos: `Script Content (from Script)`, `Author (from Script)`, `Parent Drive Link`, `Identifier`
CREATE VIEW `videos_computed` AS
SELECT
	v.`id` AS `video_id`,
	s.`script_content` AS `script_content`,
	s.`author_id` AS `script_author_id`,
	p.`drive_link` AS `parent_drive_link`,
	coalesce(s.`name`, '') || ' - ' || coalesce(u.`name`, '') AS `identifier`
FROM `videos` v
LEFT JOIN `video_scripts` s ON s.`id` = v.`script_id`
LEFT JOIN `products` p ON p.`id` = v.`product_id`
LEFT JOIN `users` u ON u.`id` = v.`editor_id`;
--> statement-breakpoint
-- Schedule: `Name (from Linked Campaign)`
CREATE VIEW `schedule_computed` AS
SELECT
	sc.`id` AS `schedule_id`,
	c.`name` AS `campaign_name`
FROM `schedule` sc
LEFT JOIN `campaigns` c ON c.`id` = sc.`campaign_id`;
