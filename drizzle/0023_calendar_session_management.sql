CREATE TABLE `session_appointment_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`appointment_id` text NOT NULL,
	`action` text NOT NULL,
	`category` text,
	`reason` text DEFAULT '' NOT NULL,
	`actor_account_id` text NOT NULL,
	`snapshot` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `session_appointment_audit_appointment_idx` ON `session_appointment_audit` (`appointment_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `session_appointment_audit_action_idx` ON `session_appointment_audit` (`action`,`created_at`);
