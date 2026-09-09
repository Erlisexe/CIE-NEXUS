CREATE TABLE `intervention_programs` (
	`id` text PRIMARY KEY NOT NULL,
	`linked_cycle_id` text,
	`name` text NOT NULL,
	`participant_name` text NOT NULL,
	`site` text NOT NULL,
	`objective` text NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`linked_cycle_id`) REFERENCES `training_cycles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `intervention_programs_status_idx` ON `intervention_programs` (`status`);--> statement-breakpoint
CREATE INDEX `intervention_programs_cycle_idx` ON `intervention_programs` (`linked_cycle_id`);--> statement-breakpoint
CREATE TABLE `intervention_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`session_date` text DEFAULT CURRENT_DATE NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`results` text DEFAULT '[]' NOT NULL,
	`transitions` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`closed_at` text,
	FOREIGN KEY (`program_id`) REFERENCES `intervention_programs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `intervention_sessions_program_idx` ON `intervention_sessions` (`program_id`);--> statement-breakpoint
CREATE INDEX `intervention_sessions_status_idx` ON `intervention_sessions` (`status`);--> statement-breakpoint
CREATE INDEX `intervention_sessions_date_idx` ON `intervention_sessions` (`session_date`);--> statement-breakpoint
CREATE TABLE `intervention_targets` (
	`id` text PRIMARY KEY NOT NULL,
	`program_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`specific_objective` text NOT NULL,
	`measurement` text DEFAULT 'percentage' NOT NULL,
	`unit_label` text DEFAULT '%' NOT NULL,
	`state` text DEFAULT 'baseline' NOT NULL,
	`criteria` text DEFAULT '{}' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`program_id`) REFERENCES `intervention_programs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `intervention_targets_program_idx` ON `intervention_targets` (`program_id`);--> statement-breakpoint
CREATE INDEX `intervention_targets_state_idx` ON `intervention_targets` (`state`);--> statement-breakpoint
CREATE TABLE `target_state_history` (
	`id` text PRIMARY KEY NOT NULL,
	`target_id` text NOT NULL,
	`session_id` text,
	`from_state` text NOT NULL,
	`to_state` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`target_id`) REFERENCES `intervention_targets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`session_id`) REFERENCES `intervention_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `target_state_history_target_idx` ON `target_state_history` (`target_id`);