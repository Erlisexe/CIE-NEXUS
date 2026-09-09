CREATE TABLE `app_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`page_name` text DEFAULT 'CIE Forma' NOT NULL,
	`institution_photo_key` text,
	`platform_photo_key` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `evaluation_history` (
	`id` text PRIMARY KEY NOT NULL,
	`cycle_id` text NOT NULL,
	`action` text NOT NULL,
	`summary` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`cycle_id`) REFERENCES `training_cycles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `evaluation_history_cycle_idx` ON `evaluation_history` (`cycle_id`);--> statement-breakpoint
ALTER TABLE `training_cycles` ADD `archived_at` text;--> statement-breakpoint
ALTER TABLE `training_cycles` ADD `archive_summary` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `training_cycles` ADD `source_cycle_id` text;