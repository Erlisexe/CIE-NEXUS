CREATE TABLE `personnel_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`full_name` text NOT NULL,
	`role` text DEFAULT 'Coordinador' NOT NULL,
	`site` text NOT NULL,
	`internal_code` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `personnel_profiles_site_idx` ON `personnel_profiles` (`site`);--> statement-breakpoint
CREATE INDEX `personnel_profiles_status_idx` ON `personnel_profiles` (`status`);--> statement-breakpoint
CREATE INDEX `personnel_profiles_name_idx` ON `personnel_profiles` (`full_name`);--> statement-breakpoint
ALTER TABLE `intervention_programs` ADD `profile_id` text REFERENCES personnel_profiles(id);--> statement-breakpoint
CREATE INDEX `intervention_programs_profile_idx` ON `intervention_programs` (`profile_id`);--> statement-breakpoint
ALTER TABLE `training_cycles` ADD `profile_id` text REFERENCES personnel_profiles(id);