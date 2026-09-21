ALTER TABLE `session_appointments` ADD `cancellation_category` text;--> statement-breakpoint
ALTER TABLE `session_appointments` ADD `cancellation_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `session_appointments` ADD `cancelled_at` text;--> statement-breakpoint
ALTER TABLE `session_appointments` ADD `cancelled_by_account_id` text;