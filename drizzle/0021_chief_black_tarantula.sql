ALTER TABLE `clinical_session_runs` ADD `source` text DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE `clinical_session_runs` ADD `duration_seconds` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `clinical_session_runs` ADD `collection_snapshot` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `clinical_session_runs` ADD `payload_hash` text DEFAULT '' NOT NULL;