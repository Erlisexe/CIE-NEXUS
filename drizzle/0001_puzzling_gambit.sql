CREATE TABLE `training_cycles` (
	`id` text PRIMARY KEY NOT NULL,
	`site` text NOT NULL,
	`participant_name` text NOT NULL,
	`role` text DEFAULT 'Coordinador' NOT NULL,
	`program_context` text NOT NULL,
	`cycle_label` text NOT NULL,
	`instrument_version` text NOT NULL,
	`route_type` text DEFAULT '4A' NOT NULL,
	`status` text DEFAULT 'initial' NOT NULL,
	`initial_scores` text DEFAULT '{}' NOT NULL,
	`teaching_plan` text DEFAULT '[]' NOT NULL,
	`reevaluation_scores` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
