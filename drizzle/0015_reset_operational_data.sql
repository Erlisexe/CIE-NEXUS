-- Reinicio controlado de datos operativos.
-- Conserva esquema, configuracion institucional, paquetes maestros,
-- formacion, permisos y plantillas integradas.
PRAGMA foreign_keys = ON;
--> statement-breakpoint
DELETE FROM `target_state_history`;
--> statement-breakpoint
DELETE FROM `graph_history`;
--> statement-breakpoint
DELETE FROM `evaluation_history`;
--> statement-breakpoint
DELETE FROM `child_documents`;
--> statement-breakpoint
DELETE FROM `reports`;
--> statement-breakpoint
DELETE FROM `analytic_graphs`;
--> statement-breakpoint
DELETE FROM `intervention_sessions`;
--> statement-breakpoint
DELETE FROM `intervention_targets`;
--> statement-breakpoint
DELETE FROM `intervention_programs`;
--> statement-breakpoint
DELETE FROM `training_cycles`;
--> statement-breakpoint
DELETE FROM `session_records`;
--> statement-breakpoint
DELETE FROM `personnel_profiles`;
--> statement-breakpoint
DELETE FROM `report_templates`
WHERE `built_in` = 0
  AND (`id` LIKE 'TEST-%' OR `name` LIKE 'TEST-%');
--> statement-breakpoint
DELETE FROM `sqlite_sequence` WHERE `name` = 'session_records';
