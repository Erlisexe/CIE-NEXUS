CREATE TABLE `clinical_data_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_account_id` text,
	`reason` text DEFAULT '' NOT NULL,
	`before_snapshot` text DEFAULT '{}' NOT NULL,
	`after_snapshot` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `clinical_data_audit_resource_idx` ON `clinical_data_audit` (`resource_type`,`resource_id`);--> statement-breakpoint
CREATE INDEX `clinical_data_audit_created_idx` ON `clinical_data_audit` (`created_at`);--> statement-breakpoint
CREATE TABLE `target_mastery_events` (
	`id` text PRIMARY KEY NOT NULL,
	`target_id` text NOT NULL,
	`program_id` text NOT NULL,
	`session_id` text,
	`mastered_at` text NOT NULL,
	`mastery_method` text NOT NULL,
	`professional_account_id` text,
	`criterion_snapshot` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`invalidated_at` text,
	`invalidated_by_account_id` text,
	`invalidation_reason` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `intervention_targets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`program_id`) REFERENCES `intervention_programs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `intervention_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `target_mastery_events_target_unique` ON `target_mastery_events` (`target_id`);--> statement-breakpoint
CREATE INDEX `target_mastery_events_program_date_idx` ON `target_mastery_events` (`program_id`,`mastered_at`);--> statement-breakpoint
CREATE INDEX `target_mastery_events_status_idx` ON `target_mastery_events` (`status`);--> statement-breakpoint
ALTER TABLE `intervention_targets` ADD `mastery_achieved` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `intervention_targets` ADD `mastered_at` text;--> statement-breakpoint
ALTER TABLE `intervention_targets` ADD `mastery_method` text;