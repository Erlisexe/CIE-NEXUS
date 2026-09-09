ALTER TABLE `analytic_graphs` ADD `profile_id` text REFERENCES personnel_profiles(id) ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE `analytic_graphs` ADD `linked_program_id` text REFERENCES intervention_programs(id) ON DELETE SET NULL;--> statement-breakpoint
UPDATE `analytic_graphs`
SET `profile_id` = (
  SELECT `training_cycles`.`profile_id`
  FROM `training_cycles`
  WHERE `training_cycles`.`id` = `analytic_graphs`.`linked_cycle_id`
)
WHERE `profile_id` IS NULL AND `linked_cycle_id` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `analytic_graphs_profile_idx` ON `analytic_graphs` (`profile_id`);--> statement-breakpoint
CREATE INDEX `analytic_graphs_program_idx` ON `analytic_graphs` (`linked_program_id`);
