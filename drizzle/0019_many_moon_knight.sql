CREATE TABLE `meeting_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`requester_account_id` text NOT NULL,
	`recipient_account_id` text NOT NULL,
	`meeting_date` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`subject` text NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`responded_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `meeting_requests_recipient_date_idx` ON `meeting_requests` (`recipient_account_id`,`meeting_date`,`start_time`);--> statement-breakpoint
CREATE INDEX `meeting_requests_requester_date_idx` ON `meeting_requests` (`requester_account_id`,`meeting_date`,`start_time`);--> statement-breakpoint
CREATE INDEX `meeting_requests_status_date_idx` ON `meeting_requests` (`status`,`meeting_date`);