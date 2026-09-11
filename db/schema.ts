import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sessionRecords = sqliteTable("session_records", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientCode: text("client_code").notNull(),
  clientName: text("client_name").notNull(),
  sessionDate: text("session_date").notNull().default(sql`CURRENT_DATE`),
  status: text("status").notNull().default("draft"),
  durationMinutes: integer("duration_minutes").notNull().default(0),
  independentCount: integer("independent_count").notNull().default(0),
  promptedCount: integer("prompted_count").notNull().default(0),
  incorrectCount: integer("incorrect_count").notNull().default(0),
  transitionsFrequency: integer("transitions_frequency").notNull().default(0),
  toleranceSeconds: integer("tolerance_seconds").notNull().default(0),
  draftNote: text("draft_note").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const personnelProfiles = sqliteTable("personnel_profiles", {
  id: text("id").primaryKey(),
  fullName: text("full_name").notNull(),
  role: text("role").notNull().default("Coordinador"),
  site: text("site").notNull(),
  internalCode: text("internal_code").notNull().default(""),
  dateOfBirth: text("date_of_birth").notNull().default(""),
  diagnosis: text("diagnosis").notNull().default(""),
  address: text("address").notNull().default(""),
  phone: text("phone").notNull().default(""),
  guardianName: text("guardian_name").notNull().default(""),
  guardianPhone: text("guardian_phone").notNull().default(""),
  preferredLanguage: text("preferred_language").notNull().default(""),
  emergencyContact: text("emergency_contact").notNull().default(""),
  customFields: text("custom_fields").notNull().default("[]"),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("personnel_profiles_site_idx").on(table.site),
  index("personnel_profiles_status_idx").on(table.status),
  index("personnel_profiles_name_idx").on(table.fullName),
]);

export const childDocuments = sqliteTable("child_documents", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => personnelProfiles.id, { onDelete: "cascade" }),
  uploadedByAccountId: text("uploaded_by_account_id"),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  description: text("description").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("child_documents_profile_idx").on(table.profileId),
  index("child_documents_created_idx").on(table.createdAt),
]);

export const trainingCycles = sqliteTable("training_cycles", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").references(() => personnelProfiles.id, { onDelete: "set null" }),
  site: text("site").notNull(),
  participantName: text("participant_name").notNull(),
  role: text("role").notNull().default("Coordinador"),
  programContext: text("program_context").notNull(),
  cycleLabel: text("cycle_label").notNull(),
  instrumentVersion: text("instrument_version").notNull(),
  packageTemplateId: text("package_template_id"),
  instrumentSnapshot: text("instrument_snapshot").notNull().default(""),
  routeType: text("route_type").notNull().default("4A"),
  status: text("status").notNull().default("initial"),
  initialScores: text("initial_scores").notNull().default("{}"),
  teachingPlan: text("teaching_plan").notNull().default("[]"),
  reevaluationScores: text("reevaluation_scores").notNull().default("{}"),
  archivedAt: text("archived_at"),
  archiveSummary: text("archive_summary").notNull().default("{}"),
  sourceCycleId: text("source_cycle_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const evaluationPackages = sqliteTable("evaluation_packages", {
  id: text("id").primaryKey(),
  familyId: text("family_id").notNull(),
  name: text("name").notNull(),
  objective: text("objective").notNull(),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("draft"),
  areas: text("areas").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("evaluation_packages_family_idx").on(table.familyId),
  index("evaluation_packages_status_idx").on(table.status),
]);

export const evaluationHistory = sqliteTable("evaluation_history", {
  id: text("id").primaryKey(),
  cycleId: text("cycle_id").notNull().references(() => trainingCycles.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  summary: text("summary").notNull(),
  details: text("details").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("evaluation_history_cycle_idx").on(table.cycleId)]);

export const appSettings = sqliteTable("app_settings", {
  id: integer("id").primaryKey(),
  pageName: text("page_name").notNull().default("CIE Nexus"),
  institutionPhotoKey: text("institution_photo_key"),
  platformPhotoKey: text("platform_photo_key"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const cieSites = sqliteTable("cie_sites", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  code: text("code").notNull().unique(),
  status: text("status").notNull().default("active"),
  createdByAccountId: text("created_by_account_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("cie_sites_status_idx").on(table.status),
  index("cie_sites_name_idx").on(table.name),
]);

export const analyticGraphs = sqliteTable("analytic_graphs", {
  id: text("id").primaryKey(),
  ownerAccountId: text("owner_account_id"),
  profileId: text("profile_id").references(() => personnelProfiles.id, { onDelete: "cascade" }),
  linkedProgramId: text("linked_program_id").references(() => interventionPrograms.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  objective: text("objective").notNull().default(""),
  graphType: text("graph_type").notNull().default("line"),
  designType: text("design_type").notNull().default("AB"),
  measurement: text("measurement").notNull().default("Porcentaje"),
  xAxisLabel: text("x_axis_label").notNull().default("Sesiones"),
  yAxisLabel: text("y_axis_label").notNull().default("Porcentaje"),
  linkedCycleId: text("linked_cycle_id").references(() => trainingCycles.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("active"),
  points: text("points").notNull().default("[]"),
  phases: text("phases").notNull().default("[]"),
  config: text("config").notNull().default("{}"),
  archivedAt: text("archived_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("analytic_graphs_type_idx").on(table.graphType),
  index("analytic_graphs_status_idx").on(table.status),
  index("analytic_graphs_profile_idx").on(table.profileId),
  index("analytic_graphs_program_idx").on(table.linkedProgramId),
  index("analytic_graphs_cycle_idx").on(table.linkedCycleId),
]);

export const graphHistory = sqliteTable("graph_history", {
  id: text("id").primaryKey(),
  graphId: text("graph_id").notNull().references(() => analyticGraphs.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  summary: text("summary").notNull(),
  details: text("details").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("graph_history_graph_idx").on(table.graphId)]);

export const interventionPrograms = sqliteTable("intervention_programs", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").references(() => personnelProfiles.id, { onDelete: "set null" }),
  linkedCycleId: text("linked_cycle_id").references(() => trainingCycles.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  participantName: text("participant_name").notNull(),
  site: text("site").notNull(),
  objective: text("objective").notNull(),
  instructions: text("instructions").notNull().default(""),
  graphConfig: text("graph_config").notNull().default('{"graphType":"line","designType":"AB","primaryTargetId":null}'),
  status: text("status").notNull().default("active"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("intervention_programs_status_idx").on(table.status),
  index("intervention_programs_profile_idx").on(table.profileId),
  index("intervention_programs_cycle_idx").on(table.linkedCycleId),
]);

export const interventionTargets = sqliteTable("intervention_targets", {
  id: text("id").primaryKey(),
  programId: text("program_id").notNull().references(() => interventionPrograms.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  specificObjective: text("specific_objective").notNull(),
  measurement: text("measurement").notNull().default("percentage"),
  unitLabel: text("unit_label").notNull().default("%"),
  state: text("state").notNull().default("baseline"),
  criteria: text("criteria").notNull().default("{}"),
  masteryAchieved: integer("mastery_achieved", { mode: "boolean" }).notNull().default(false),
  masteredAt: text("mastered_at"),
  masteryMethod: text("mastery_method"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("intervention_targets_program_idx").on(table.programId),
  index("intervention_targets_state_idx").on(table.state),
]);

export const sessionNoteTemplates = sqliteTable("session_note_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  fields: text("fields").notNull().default("[]"),
  builtIn: integer("built_in", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("active"),
  createdByAccountId: text("created_by_account_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("session_note_templates_status_idx").on(table.status),
  index("session_note_templates_updated_idx").on(table.updatedAt),
]);

export const clinicalSessionRuns = sqliteTable("clinical_session_runs", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => personnelProfiles.id, { onDelete: "cascade" }),
  appointmentId: text("appointment_id").unique(),
  professionalAccountId: text("professional_account_id").notNull(),
  sessionDate: text("session_date").notNull().default(sql`CURRENT_DATE`),
  context: text("context").notNull().default(""),
  source: text("source").notNull().default("web"),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  collectionSnapshot: text("collection_snapshot").notNull().default("{}"),
  payloadHash: text("payload_hash").notNull().default(""),
  noteTemplateId: text("note_template_id").references(() => sessionNoteTemplates.id, { onDelete: "set null" }),
  noteTemplateSnapshot: text("note_template_snapshot").notNull().default("{}"),
  noteValues: text("note_values").notNull().default("{}"),
  noteText: text("note_text").notNull().default(""),
  status: text("status").notNull().default("closed"),
  startedAt: text("started_at"),
  closedAt: text("closed_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("clinical_session_runs_profile_date_idx").on(table.profileId, table.sessionDate),
  index("clinical_session_runs_professional_date_idx").on(table.professionalAccountId, table.sessionDate),
  index("clinical_session_runs_status_idx").on(table.status),
]);

export const interventionSessions = sqliteTable("intervention_sessions", {
  id: text("id").primaryKey(),
  clinicalSessionRunId: text("clinical_session_run_id").references(() => clinicalSessionRuns.id, { onDelete: "cascade" }),
  programId: text("program_id").notNull().references(() => interventionPrograms.id, { onDelete: "cascade" }),
  sessionDate: text("session_date").notNull().default(sql`CURRENT_DATE`),
  context: text("context").notNull().default(""),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("draft"),
  results: text("results").notNull().default("[]"),
  transitions: text("transitions").notNull().default("[]"),
  professionalAccountId: text("professional_account_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  closedAt: text("closed_at"),
}, (table) => [
  index("intervention_sessions_run_idx").on(table.clinicalSessionRunId),
  index("intervention_sessions_program_idx").on(table.programId),
  index("intervention_sessions_status_idx").on(table.status),
  index("intervention_sessions_date_idx").on(table.sessionDate),
  index("intervention_sessions_professional_date_idx").on(table.professionalAccountId, table.sessionDate),
]);

export const targetMasteryEvents = sqliteTable("target_mastery_events", {
  id: text("id").primaryKey(),
  targetId: text("target_id").notNull().references(() => interventionTargets.id, { onDelete: "cascade" }),
  programId: text("program_id").notNull().references(() => interventionPrograms.id, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => interventionSessions.id, { onDelete: "set null" }),
  masteredAt: text("mastered_at").notNull(),
  masteryMethod: text("mastery_method").notNull(),
  professionalAccountId: text("professional_account_id"),
  criterionSnapshot: text("criterion_snapshot").notNull().default("{}"),
  status: text("status").notNull().default("active"),
  invalidatedAt: text("invalidated_at"),
  invalidatedByAccountId: text("invalidated_by_account_id"),
  invalidationReason: text("invalidation_reason").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("target_mastery_events_target_unique").on(table.targetId),
  index("target_mastery_events_program_date_idx").on(table.programId, table.masteredAt),
  index("target_mastery_events_status_idx").on(table.status),
]);

export const clinicalDataAudit = sqliteTable("clinical_data_audit", {
  id: text("id").primaryKey(),
  resourceType: text("resource_type").notNull(),
  resourceId: text("resource_id").notNull(),
  action: text("action").notNull(),
  actorAccountId: text("actor_account_id"),
  reason: text("reason").notNull().default(""),
  beforeSnapshot: text("before_snapshot").notNull().default("{}"),
  afterSnapshot: text("after_snapshot").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("clinical_data_audit_resource_idx").on(table.resourceType, table.resourceId),
  index("clinical_data_audit_created_idx").on(table.createdAt),
]);

export const sessionAppointments = sqliteTable("session_appointments", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => personnelProfiles.id, { onDelete: "cascade" }),
  professionalAccountId: text("professional_account_id").notNull(),
  site: text("site").notNull(),
  sessionDate: text("session_date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  sessionType: text("session_type").notNull().default("Terapia individual"),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("scheduled"),
  cancellationCategory: text("cancellation_category"),
  cancellationReason: text("cancellation_reason").notNull().default(""),
  cancelledAt: text("cancelled_at"),
  cancelledByAccountId: text("cancelled_by_account_id"),
  clinicalSessionRunId: text("clinical_session_run_id").unique().references(() => clinicalSessionRuns.id, { onDelete: "set null" }),
  interventionSessionId: text("intervention_session_id").unique().references(() => interventionSessions.id, { onDelete: "set null" }),
  createdByAccountId: text("created_by_account_id").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("session_appointments_professional_date_idx").on(table.professionalAccountId, table.sessionDate),
  index("session_appointments_profile_date_idx").on(table.profileId, table.sessionDate),
  index("session_appointments_site_date_idx").on(table.site, table.sessionDate),
  index("session_appointments_status_date_idx").on(table.status, table.sessionDate),
]);

export const meetingRequests = sqliteTable("meeting_requests", {
  id: text("id").primaryKey(),
  requesterAccountId: text("requester_account_id").notNull(),
  recipientAccountId: text("recipient_account_id").notNull(),
  meetingDate: text("meeting_date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("pending"),
  respondedAt: text("responded_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("meeting_requests_recipient_date_idx").on(table.recipientAccountId, table.meetingDate, table.startTime),
  index("meeting_requests_requester_date_idx").on(table.requesterAccountId, table.meetingDate, table.startTime),
  index("meeting_requests_status_date_idx").on(table.status, table.meetingDate),
]);

export const abcCategories = sqliteTable("abc_categories", {
  id: text("id").primaryKey(),
  categoryType: text("category_type").notNull(),
  label: text("label").notNull(),
  status: text("status").notNull().default("active"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdByAccountId: text("created_by_account_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("abc_categories_type_label_unique").on(table.categoryType, table.label),
  index("abc_categories_type_status_idx").on(table.categoryType, table.status),
  index("abc_categories_sort_idx").on(table.categoryType, table.sortOrder),
]);

export const abcRecords = sqliteTable("abc_records", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").notNull().references(() => personnelProfiles.id, { onDelete: "cascade" }),
  appointmentId: text("appointment_id").references(() => sessionAppointments.id, { onDelete: "set null" }),
  sessionId: text("session_id").references(() => interventionSessions.id, { onDelete: "set null" }),
  programId: text("program_id").references(() => interventionPrograms.id, { onDelete: "set null" }),
  targetId: text("target_id").references(() => interventionTargets.id, { onDelete: "set null" }),
  recordedByAccountId: text("recorded_by_account_id").notNull(),
  recordedByName: text("recorded_by_name").notNull(),
  eventDate: text("event_date").notNull(),
  eventTime: text("event_time").notNull(),
  locationContext: text("location_context").notNull().default(""),
  activity: text("activity").notNull().default(""),
  antecedentCategoryId: text("antecedent_category_id").references(() => abcCategories.id, { onDelete: "set null" }),
  antecedentLabel: text("antecedent_label").notNull(),
  antecedentDescription: text("antecedent_description").notNull().default(""),
  behaviorLabel: text("behavior_label").notNull(),
  behaviorDescription: text("behavior_description").notNull().default(""),
  consequenceCategoryId: text("consequence_category_id").references(() => abcCategories.id, { onDelete: "set null" }),
  consequenceLabel: text("consequence_label").notNull(),
  consequenceDescription: text("consequence_description").notNull().default(""),
  additionalObservation: text("additional_observation").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("abc_records_profile_event_idx").on(table.profileId, table.eventDate, table.eventTime),
  index("abc_records_profile_behavior_idx").on(table.profileId, table.behaviorLabel),
  index("abc_records_program_idx").on(table.programId),
  index("abc_records_target_idx").on(table.targetId),
  index("abc_records_session_idx").on(table.sessionId),
  index("abc_records_appointment_idx").on(table.appointmentId),
  index("abc_records_recorder_idx").on(table.recordedByAccountId),
]);

export const targetStateHistory = sqliteTable("target_state_history", {
  id: text("id").primaryKey(),
  targetId: text("target_id").notNull().references(() => interventionTargets.id, { onDelete: "cascade" }),
  sessionId: text("session_id").references(() => interventionSessions.id, { onDelete: "set null" }),
  fromState: text("from_state").notNull(),
  toState: text("to_state").notNull(),
  reason: text("reason").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("target_state_history_target_idx").on(table.targetId)]);

export const formationCourses = sqliteTable("formation_courses", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  audience: text("audience").notNull().default(""),
  durationHours: integer("duration_hours").notNull().default(45),
  status: text("status").notNull().default("draft"),
  content: text("content").notNull().default('{"chapters":[]}'),
  publishedAt: text("published_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("formation_courses_status_idx").on(table.status),
  index("formation_courses_updated_idx").on(table.updatedAt),
]);

export const reportTemplates = sqliteTable("report_templates", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  reportType: text("report_type").notNull().default("Clínico"),
  description: text("description").notNull().default(""),
  blocks: text("blocks").notNull().default("[]"),
  builtIn: integer("built_in", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("active"),
  createdByAccountId: text("created_by_account_id"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("report_templates_status_idx").on(table.status),
  index("report_templates_type_idx").on(table.reportType),
  index("report_templates_updated_idx").on(table.updatedAt),
]);

export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  profileId: text("profile_id").references(() => personnelProfiles.id, { onDelete: "cascade" }),
  templateId: text("template_id").references(() => reportTemplates.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  reportType: text("report_type").notNull().default("Clínico"),
  status: text("status").notNull().default("draft"),
  blocks: text("blocks").notNull().default("[]"),
  profileSnapshot: text("profile_snapshot").notNull().default("{}"),
  sourceSelection: text("source_selection").notNull().default("[]"),
  authorAccountId: text("author_account_id").notNull(),
  authorName: text("author_name").notNull(),
  finalizedAt: text("finalized_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("reports_profile_idx").on(table.profileId),
  index("reports_status_idx").on(table.status),
  index("reports_template_idx").on(table.templateId),
  index("reports_author_idx").on(table.authorAccountId),
  index("reports_updated_idx").on(table.updatedAt),
]);
