CREATE TABLE `clinical_session_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`appointment_id` text,
	`professional_account_id` text NOT NULL,
	`session_date` text DEFAULT CURRENT_DATE NOT NULL,
	`context` text DEFAULT '' NOT NULL,
	`note_template_id` text,
	`note_template_snapshot` text DEFAULT '{}' NOT NULL,
	`note_values` text DEFAULT '{}' NOT NULL,
	`note_text` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'closed' NOT NULL,
	`started_at` text,
	`closed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `personnel_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`note_template_id`) REFERENCES `session_note_templates`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clinical_session_runs_appointment_id_unique` ON `clinical_session_runs` (`appointment_id`);--> statement-breakpoint
CREATE INDEX `clinical_session_runs_profile_date_idx` ON `clinical_session_runs` (`profile_id`,`session_date`);--> statement-breakpoint
CREATE INDEX `clinical_session_runs_professional_date_idx` ON `clinical_session_runs` (`professional_account_id`,`session_date`);--> statement-breakpoint
CREATE INDEX `clinical_session_runs_status_idx` ON `clinical_session_runs` (`status`);--> statement-breakpoint
CREATE TABLE `session_note_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`fields` text DEFAULT '[]' NOT NULL,
	`built_in` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_account_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `session_note_templates_status_idx` ON `session_note_templates` (`status`);--> statement-breakpoint
CREATE INDEX `session_note_templates_updated_idx` ON `session_note_templates` (`updated_at`);--> statement-breakpoint
ALTER TABLE `intervention_sessions` ADD `clinical_session_run_id` text REFERENCES clinical_session_runs(id);--> statement-breakpoint
CREATE INDEX `intervention_sessions_run_idx` ON `intervention_sessions` (`clinical_session_run_id`);--> statement-breakpoint
ALTER TABLE `session_appointments` ADD `clinical_session_run_id` text REFERENCES clinical_session_runs(id);--> statement-breakpoint
CREATE UNIQUE INDEX `session_appointments_clinical_session_run_id_unique` ON `session_appointments` (`clinical_session_run_id`);
--> statement-breakpoint
PRAGMA optimize;
