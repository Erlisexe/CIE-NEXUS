CREATE TABLE `analytic_graphs` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`objective` text DEFAULT '' NOT NULL,
	`graph_type` text DEFAULT 'line' NOT NULL,
	`design_type` text DEFAULT 'AB' NOT NULL,
	`measurement` text DEFAULT 'Porcentaje' NOT NULL,
	`x_axis_label` text DEFAULT 'Sesiones' NOT NULL,
	`y_axis_label` text DEFAULT 'Porcentaje' NOT NULL,
	`linked_cycle_id` text,
	`status` text DEFAULT 'active' NOT NULL,
	`points` text DEFAULT '[]' NOT NULL,
	`phases` text DEFAULT '[]' NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`linked_cycle_id`) REFERENCES `training_cycles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `analytic_graphs_type_idx` ON `analytic_graphs` (`graph_type`);--> statement-breakpoint
CREATE INDEX `analytic_graphs_status_idx` ON `analytic_graphs` (`status`);--> statement-breakpoint
CREATE INDEX `analytic_graphs_cycle_idx` ON `analytic_graphs` (`linked_cycle_id`);--> statement-breakpoint
CREATE TABLE `graph_history` (
	`id` text PRIMARY KEY NOT NULL,
	`graph_id` text NOT NULL,
	`action` text NOT NULL,
	`summary` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`graph_id`) REFERENCES `analytic_graphs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `graph_history_graph_idx` ON `graph_history` (`graph_id`);