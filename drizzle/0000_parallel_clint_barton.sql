CREATE TABLE `session_records` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_code` text NOT NULL,
	`client_name` text NOT NULL,
	`session_date` text DEFAULT CURRENT_DATE NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`duration_minutes` integer DEFAULT 0 NOT NULL,
	`independent_count` integer DEFAULT 0 NOT NULL,
	`prompted_count` integer DEFAULT 0 NOT NULL,
	`incorrect_count` integer DEFAULT 0 NOT NULL,
	`transitions_frequency` integer DEFAULT 0 NOT NULL,
	`tolerance_seconds` integer DEFAULT 0 NOT NULL,
	`draft_note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
