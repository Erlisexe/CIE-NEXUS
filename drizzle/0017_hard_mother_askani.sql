CREATE TABLE `abc_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`category_type` text NOT NULL,
	`label` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_by_account_id` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `abc_categories_type_label_unique` ON `abc_categories` (`category_type`,`label`);--> statement-breakpoint
CREATE INDEX `abc_categories_type_status_idx` ON `abc_categories` (`category_type`,`status`);--> statement-breakpoint
CREATE INDEX `abc_categories_sort_idx` ON `abc_categories` (`category_type`,`sort_order`);--> statement-breakpoint
CREATE TABLE `abc_records` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`appointment_id` text,
	`session_id` text,
	`program_id` text,
	`target_id` text,
	`recorded_by_account_id` text NOT NULL,
	`recorded_by_name` text NOT NULL,
	`event_date` text NOT NULL,
	`event_time` text NOT NULL,
	`location_context` text DEFAULT '' NOT NULL,
	`activity` text DEFAULT '' NOT NULL,
	`antecedent_category_id` text,
	`antecedent_label` text NOT NULL,
	`antecedent_description` text DEFAULT '' NOT NULL,
	`behavior_label` text NOT NULL,
	`behavior_description` text DEFAULT '' NOT NULL,
	`consequence_category_id` text,
	`consequence_label` text NOT NULL,
	`consequence_description` text DEFAULT '' NOT NULL,
	`additional_observation` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `personnel_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`appointment_id`) REFERENCES `session_appointments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`session_id`) REFERENCES `intervention_sessions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`program_id`) REFERENCES `intervention_programs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`target_id`) REFERENCES `intervention_targets`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`antecedent_category_id`) REFERENCES `abc_categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`consequence_category_id`) REFERENCES `abc_categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `abc_records_profile_event_idx` ON `abc_records` (`profile_id`,`event_date`,`event_time`);--> statement-breakpoint
CREATE INDEX `abc_records_profile_behavior_idx` ON `abc_records` (`profile_id`,`behavior_label`);--> statement-breakpoint
CREATE INDEX `abc_records_program_idx` ON `abc_records` (`program_id`);--> statement-breakpoint
CREATE INDEX `abc_records_target_idx` ON `abc_records` (`target_id`);--> statement-breakpoint
CREATE INDEX `abc_records_session_idx` ON `abc_records` (`session_id`);--> statement-breakpoint
CREATE INDEX `abc_records_appointment_idx` ON `abc_records` (`appointment_id`);--> statement-breakpoint
CREATE INDEX `abc_records_recorder_idx` ON `abc_records` (`recorded_by_account_id`);--> statement-breakpoint
INSERT INTO `abc_categories` (`id`,`category_type`,`label`,`sort_order`) VALUES
	('abc-ant-demand','antecedent','Presentación de demanda',10),
	('abc-ant-remove','antecedent','Retiro de objeto o actividad',20),
	('abc-ant-attention-withdrawn','antecedent','Atención retirada',30),
	('abc-ant-low-attention','antecedent','Atención baja',40),
	('abc-ant-transition','antecedent','Transición',50),
	('abc-ant-wait','antecedent','Espera',60),
	('abc-ant-denied','antecedent','Acceso negado',70),
	('abc-ant-social','antecedent','Interacción social',80),
	('abc-ant-independent-play','antecedent','Juego independiente',90),
	('abc-ant-other','antecedent','Otro',100),
	('abc-con-attention','consequence','Atención',10),
	('abc-con-escape','consequence','Escape o interrupción de demanda',20),
	('abc-con-tangible','consequence','Acceso a tangible o actividad',30),
	('abc-con-redirect','consequence','Redirección',40),
	('abc-con-ignore','consequence','Ignorar',50),
	('abc-con-physical-help','consequence','Ayuda física',60),
	('abc-con-demand-continues','consequence','Continuación de demanda',70),
	('abc-con-social','consequence','Interacción social',80),
	('abc-con-none','consequence','Sin consecuencia programada',90),
	('abc-con-other','consequence','Otro',100);
--> statement-breakpoint
UPDATE `app_settings`
SET `page_name` = 'CIE Nexus', `updated_at` = CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `intervention_programs` ADD `graph_config` text DEFAULT '{"graphType":"line","designType":"AB","primaryTargetId":null}' NOT NULL;
--> statement-breakpoint
DROP INDEX `intervention_sessions_therapist_date_idx`;
--> statement-breakpoint
ALTER TABLE `intervention_sessions` RENAME COLUMN `therapist_account_id` TO `professional_account_id`;
--> statement-breakpoint
CREATE INDEX `intervention_sessions_professional_date_idx` ON `intervention_sessions` (`professional_account_id`,`session_date`);
--> statement-breakpoint
DROP INDEX `session_appointments_therapist_date_idx`;
--> statement-breakpoint
ALTER TABLE `session_appointments` RENAME COLUMN `therapist_account_id` TO `professional_account_id`;
--> statement-breakpoint
CREATE INDEX `session_appointments_professional_date_idx` ON `session_appointments` (`professional_account_id`,`session_date`);
