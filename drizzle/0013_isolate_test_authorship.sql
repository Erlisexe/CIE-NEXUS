-- TEST FIXTURE CORRECTION: elimina referencias de autoría real sólo de registros TEST-*.
-- No cambia el esquema ni modifica registros institucionales existentes.
UPDATE `report_templates`
SET `created_by_account_id` = 'TEST-DIRECTOR-001'
WHERE `id` LIKE 'TEST-%';
--> statement-breakpoint
UPDATE `analytic_graphs`
SET `owner_account_id` = 'TEST-DIRECTOR-001'
WHERE `id` LIKE 'TEST-%';
--> statement-breakpoint
UPDATE `reports`
SET
  `author_account_id` = 'TEST-DIRECTOR-001',
  `author_name` = 'TEST-DIRECCION-CLINICA-001',
  `blocks` = replace(
    replace(`blocks`, 'e45abfc1-bbd3-475a-96cd-391fcbdf88be', 'TEST-DIRECTOR-001'),
    'Erlis Cuevas Aguirre',
    'TEST-DIRECCION-CLINICA-001'
  )
WHERE `id` LIKE 'TEST-%';
