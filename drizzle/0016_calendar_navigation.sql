CREATE TABLE `cie_sites` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_account_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cie_sites_name_unique` ON `cie_sites` (`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `cie_sites_code_unique` ON `cie_sites` (`code`);
--> statement-breakpoint
CREATE INDEX `cie_sites_status_idx` ON `cie_sites` (`status`);
--> statement-breakpoint
CREATE INDEX `cie_sites_name_idx` ON `cie_sites` (`name`);
--> statement-breakpoint
INSERT INTO `cie_sites` (`id`, `name`, `code`, `status`) VALUES
	('site-leon', 'León', 'LEO', 'active'),
	('site-esteli', 'Estelí', 'EST', 'active'),
	('site-santo-domingo', 'Santo Domingo', 'SDO', 'active'),
	('site-las-colinas', 'Las Colinas', 'LCO', 'active'),
	('site-masaya', 'Masaya', 'MAS', 'active');
--> statement-breakpoint
ALTER TABLE `intervention_sessions` ADD `therapist_account_id` text;
--> statement-breakpoint
CREATE INDEX `intervention_sessions_therapist_date_idx` ON `intervention_sessions` (`therapist_account_id`,`session_date`);
--> statement-breakpoint
CREATE TABLE `session_appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`therapist_account_id` text NOT NULL,
	`site` text NOT NULL,
	`session_date` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`session_type` text DEFAULT 'Terapia individual' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`intervention_session_id` text,
	`created_by_account_id` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `personnel_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`intervention_session_id`) REFERENCES `intervention_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_appointments_intervention_session_id_unique` ON `session_appointments` (`intervention_session_id`);
--> statement-breakpoint
CREATE INDEX `session_appointments_therapist_date_idx` ON `session_appointments` (`therapist_account_id`,`session_date`);
--> statement-breakpoint
CREATE INDEX `session_appointments_profile_date_idx` ON `session_appointments` (`profile_id`,`session_date`);
--> statement-breakpoint
CREATE INDEX `session_appointments_site_date_idx` ON `session_appointments` (`site`,`session_date`);
--> statement-breakpoint
CREATE INDEX `session_appointments_status_date_idx` ON `session_appointments` (`status`,`session_date`);
