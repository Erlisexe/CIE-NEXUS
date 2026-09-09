CREATE TABLE `evaluation_packages` (
	`id` text PRIMARY KEY NOT NULL,
	`family_id` text NOT NULL,
	`name` text NOT NULL,
	`objective` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`areas` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `evaluation_packages_family_idx` ON `evaluation_packages` (`family_id`);--> statement-breakpoint
CREATE INDEX `evaluation_packages_status_idx` ON `evaluation_packages` (`status`);--> statement-breakpoint
ALTER TABLE `training_cycles` ADD `package_template_id` text;--> statement-breakpoint
ALTER TABLE `training_cycles` ADD `instrument_snapshot` text DEFAULT '' NOT NULL;