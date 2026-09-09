CREATE TABLE `report_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`report_type` text DEFAULT 'Clínico' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`blocks` text DEFAULT '[]' NOT NULL,
	`built_in` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_account_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `report_templates_status_idx` ON `report_templates` (`status`);--> statement-breakpoint
CREATE INDEX `report_templates_type_idx` ON `report_templates` (`report_type`);--> statement-breakpoint
CREATE INDEX `report_templates_updated_idx` ON `report_templates` (`updated_at`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text,
	`template_id` text,
	`title` text NOT NULL,
	`report_type` text DEFAULT 'Clínico' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`blocks` text DEFAULT '[]' NOT NULL,
	`profile_snapshot` text DEFAULT '{}' NOT NULL,
	`source_selection` text DEFAULT '[]' NOT NULL,
	`author_account_id` text NOT NULL,
	`author_name` text NOT NULL,
	`finalized_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `personnel_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `report_templates`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `reports_profile_idx` ON `reports` (`profile_id`);--> statement-breakpoint
CREATE INDEX `reports_status_idx` ON `reports` (`status`);--> statement-breakpoint
CREATE INDEX `reports_template_idx` ON `reports` (`template_id`);--> statement-breakpoint
CREATE INDEX `reports_author_idx` ON `reports` (`author_account_id`);--> statement-breakpoint
CREATE INDEX `reports_updated_idx` ON `reports` (`updated_at`);