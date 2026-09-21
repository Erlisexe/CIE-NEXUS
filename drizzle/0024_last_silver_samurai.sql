ALTER TABLE `abc_records` ADD `intensity` integer;--> statement-breakpoint
ALTER TABLE `intervention_targets` ADD `session_config` text DEFAULT '{}' NOT NULL;