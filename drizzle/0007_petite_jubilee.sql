CREATE TABLE `formation_courses` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`audience` text DEFAULT '' NOT NULL,
	`duration_hours` integer DEFAULT 45 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`content` text DEFAULT '{"chapters":[]}' NOT NULL,
	`published_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `formation_courses_slug_unique` ON `formation_courses` (`slug`);--> statement-breakpoint
CREATE INDEX `formation_courses_status_idx` ON `formation_courses` (`status`);--> statement-breakpoint
CREATE INDEX `formation_courses_updated_idx` ON `formation_courses` (`updated_at`);