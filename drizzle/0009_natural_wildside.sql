CREATE TABLE `child_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`uploaded_by_account_id` text,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`storage_key` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `personnel_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `child_documents_storage_key_unique` ON `child_documents` (`storage_key`);--> statement-breakpoint
CREATE INDEX `child_documents_profile_idx` ON `child_documents` (`profile_id`);--> statement-breakpoint
CREATE INDEX `child_documents_created_idx` ON `child_documents` (`created_at`);--> statement-breakpoint
ALTER TABLE `personnel_profiles` ADD `date_of_birth` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `personnel_profiles` ADD `diagnosis` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `personnel_profiles` ADD `address` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `personnel_profiles` ADD `phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `personnel_profiles` ADD `guardian_name` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `personnel_profiles` ADD `guardian_phone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `personnel_profiles` ADD `preferred_language` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `personnel_profiles` ADD `emergency_contact` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `personnel_profiles` ADD `custom_fields` text DEFAULT '[]' NOT NULL;