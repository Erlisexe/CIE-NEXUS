import { normalizeCriteria, normalizeCriterion, normalizeTargetState, normalizeTrials, replayClinicalProgram, type ClinicalSessionResult } from "./clinical-mastery.ts";
import { normalizeTrialDetails } from "./trial-data.ts";
import { DEFAULT_SESSION_NOTE_TEMPLATE, formatSessionNoteText, normalizeSessionNoteValues, sanitizeSessionNoteFields, type SessionNoteTemplateSnapshot } from "./session-note-templates.ts";
import { CollectionError, capturedResult, collectionDateTime, programDefinition, targetDefinition, templateDefinition, validateCollectionPayload, validateCollectionReview, type CollectionPayload, type CollectionPreparation, type CollectionProgram, type CollectionReceipt, type CollectionTarget } from "./mobile-collection.ts";
import { deriveMobileCapabilities } from "./mobile-api-contract.ts";

type Row = Record<string, unknown>;
type Statement = { bind(...values: unknown[]): Statement; all<T = Row>(): Promise<{ results: T[] }>; first<T = Row>(): Promise<T | null> };
export type CollectionDatabase = { prepare(sql: string): Statement; batch(statements: Statement[]): Promise<unknown> };
export type CollectionActor = { id: string; displayName: string; role: string; assignedProfileIds: string[]; permissions: string[] };
type Sql = { sql: string; values: unknown[] };
const text = (v: unknown) => typeof v === "string" ? v : "";
const parsed = <T>(v: unknown, fallback: T): T => { try { return typeof v === "string" ? JSON.parse(v) as T : fallback; } catch { return fallback; } };
const all = async (db: CollectionDatabase, sql: string, ...values: unknown[]) => (await db.prepare(sql).bind(...values).all<Row>()).results;
const fail = (code: string, message: string, status = 409): never => { throw new CollectionError(code, message, status); };
function targetFromRow(r: Row): CollectionTarget {
  return { id: text(r.id), code: text(r.code), name: text(r.name), specificObjective: text(r.specific_objective), measurement: text(r.measurement),
    unitLabel: text(r.unit_label), state: normalizeTargetState(r.state), criteria: normalizeCriteria(r.criteria, text(r.measurement)) };
}
function programFromRow(r: Row, targets: Row[]): CollectionProgram {
  return { id: text(r.id), name: text(r.name), objective: text(r.objective), instructions: text(r.instructions), targets: targets.filter((t) => t.program_id === r.id).map(targetFromRow) };
}
function templatesFromRows(rows: Row[]): SessionNoteTemplateSnapshot[] {
  const templates = rows.map((r) => ({ id: text(r.id), name: text(r.name), description: text(r.description), fields: sanitizeSessionNoteFields(parsed(r.fields, [])) }));
  if (!templates.some((t) => t.id === DEFAULT_SESSION_NOTE_TEMPLATE.id)) templates.unshift({ ...DEFAULT_SESSION_NOTE_TEMPLATE, fields: DEFAULT_SESSION_NOTE_TEMPLATE.fields.map((f) => ({ ...f })) });
  return templates;
}
async function requireScope(db: CollectionDatabase, actor: CollectionActor, profileId: string, appointmentId: string | null) {
  if (!deriveMobileCapabilities(actor.role, actor.permissions).recordSessions) fail("permission_denied", "Tu rol no permite registrar sesiones.", 403);
  const [profile] = await all(db, "SELECT * FROM personnel_profiles WHERE id = ? AND status = 'active'", profileId);
  if (!profile) fail("profile_unavailable", "El perfil del niño ya no está activo.", 403);
  const [appointment] = appointmentId ? await all(db, "SELECT * FROM session_appointments WHERE id = ?", appointmentId) : [];
  if (appointmentId && (!appointment || appointment.professional_account_id !== actor.id || appointment.profile_id !== profileId)) fail("appointment_out_of_scope", "La cita no corresponde a este niño y profesional.", 403);
  if (actor.role === "terapeuta" && !appointment) fail("appointment_required", "Inicia la terapia desde una cita asignada en tu agenda.", 403);
  if (!appointment && !actor.assignedProfileIds.includes(profileId)) fail("profile_out_of_scope", "Este niño no está asignado a tu cuenta móvil.", 403);
  if (appointment && (!["scheduled", "in_progress"].includes(text(appointment.status)) || appointment.intervention_session_id || appointment.clinical_session_run_id)) fail("appointment_conflict", "La cita fue cancelada o ya tiene una sesión registrada. Los datos del teléfono se conservan.");
  return { profile: profile!, appointment: appointment || null };
}
export async function prepareMobileCollection(db: CollectionDatabase, actor: CollectionActor, profileId: string, appointmentId: string | null): Promise<CollectionPreparation> {
  const { profile, appointment } = await requireScope(db, actor, profileId, appointmentId);
  const programs = await all(db, "SELECT * FROM intervention_programs WHERE profile_id = ? AND status = 'active' ORDER BY name", profileId);
  const targets = await all(db, "SELECT * FROM intervention_targets WHERE program_id IN (SELECT value FROM json_each(?)) ORDER BY sort_order", JSON.stringify(programs.map((p) => p.id)));
  const templates = await all(db, "SELECT * FROM session_note_templates WHERE status = 'active' ORDER BY built_in DESC, name");
  const activePrograms = programs.map((p) => programFromRow(p, targets)).map((p) => ({ ...p, targets: p.targets.filter((t) => t.state !== "closed") })).filter((p) => p.targets.length);
  if (!activePrograms.length) fail("programs_required", "El niño no tiene programas activos con targets abiertos.", 400);
  return { profile: { id: text(profile.id), fullName: text(profile.full_name), site: text(profile.site) },
    appointment: appointment ? { id: text(appointment.id), sessionDate: text(appointment.session_date), startTime: text(appointment.start_time), endTime: text(appointment.end_time), notes: text(appointment.notes) } : null,
    programs: activePrograms, templates: templatesFromRows(templates), professionalAccountId: actor.id, canRecordAbc: deriveMobileCapabilities(actor.role, actor.permissions).recordAbc, preparedAt: new Date().toISOString() };
}
// D1 batch is transactional. A failed database-side snapshot assertion rolls back
// the run, all program sessions, ABC records, transitions and mastery together.
async function snapshot(db: CollectionDatabase, table: string, where: string, values: unknown[]) {
  const rows = await all(db, `SELECT * FROM ${table} WHERE ${where} ORDER BY id`, ...values);
  const keys = rows.length ? Object.keys(rows[0]!) : ["id"];
  const object = keys.map((k) => `'${k}', "${k}"`).join(",");
  const query = `SELECT json_group_array(json_object(${object})) FROM (SELECT * FROM ${table} WHERE ${where} ORDER BY id)`;
  return { rows, guard: { sql: `SELECT json(CASE WHEN (${query}) IS ? THEN 'true' ELSE 'clinical_snapshot_changed' END)`, values: [...values, JSON.stringify(rows)] } as Sql };
}
function insert(table: string, row: Row): Sql {
  const keys = Object.keys(row);
  return { sql: `INSERT INTO ${table} (${keys.map((k) => `"${k}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`, values: keys.map((k) => row[k]) };
}
function update(table: string, id: unknown, row: Row): Sql {
  const keys = Object.keys(row);
  return { sql: `UPDATE ${table} SET ${keys.map((k) => `"${k}" = ?`).join(",")} WHERE id = ?`, values: [...keys.map((k) => row[k]), id] };
}
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}
export async function collectionHash(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}
function storedResult(raw: Row, target: CollectionTarget): ClinicalSessionResult {
  const trials = normalizeTrials(raw.trials);
  const stateAtSession = normalizeTargetState(raw.stateAtSession);
  const trialDetails = normalizeTrialDetails(raw.trialDetails, trials);
  const rawSnapshot = raw.criterionSnapshot && typeof raw.criterionSnapshot === "object" ? raw.criterionSnapshot as Row : null;
  const snapshotState = rawSnapshot ? normalizeTargetState(rawSnapshot.state) : null;
  const criterionSnapshot = rawSnapshot && snapshotState !== "closed" && snapshotState === stateAtSession
    ? { state: snapshotState, criterion: normalizeCriterion(rawSnapshot.criterion, snapshotState, target.measurement) }
    : undefined;
  return { targetId: target.id, sampled: raw.sampled !== false, value: typeof raw.value === "number" ? raw.value : null,
    correct: trials.length ? trials.reduce<number>((n, v) => n + v, 0) : typeof raw.correct === "number" ? raw.correct : null, opportunities: trials.length || Number(raw.opportunities) || 0,
    trials, ...(trialDetails.length ? { trialDetails } : {}), note: text(raw.note), stateAtSession,
    ...(criterionSnapshot ? { criterionSnapshot } : {}), criterionStatus: "not_evaluated", criterionReason: "" };
}
async function existingReceipt(db: CollectionDatabase, id: string, actorId: string, hash: string): Promise<CollectionReceipt | null> {
  const [row] = await all(db, "SELECT * FROM clinical_session_runs WHERE id = ?", id);
  if (!row) return null;
  if (row.professional_account_id !== actorId || row.source !== "mobile" || row.payload_hash !== hash) fail("idempotency_conflict", "Este identificador ya tiene otro contenido. La versión local se conserva para revisión.");
  if (row.status !== "closed") fail("session_not_closed", "La sesión requiere revisión antes de reenviarse.");
  const sessions = await all(db, "SELECT id FROM intervention_sessions WHERE clinical_session_run_id = ? ORDER BY id", id);
  return { id, status: "closed", closedAt: text(row.closed_at), sessionIds: sessions.map((s) => text(s.id)), duplicate: true };
}
export async function syncMobileCollection(db: CollectionDatabase, actor: CollectionActor, raw: unknown): Promise<CollectionReceipt> {
  const payload = validateCollectionPayload(raw);
  if (!deriveMobileCapabilities(actor.role, actor.permissions).recordSessions) fail("permission_denied", "Tu rol no permite registrar sesiones.", 403);
  if (payload.preparation.professionalAccountId !== actor.id) fail("collector_mismatch", "Inicia sesión con la cuenta que recolectó estos datos.", 403);
  const hash = await collectionHash(payload);
  const previous = await existingReceipt(db, payload.id, actor.id, hash); if (previous) return previous;
  // Confirmed legacy receipts keep their original hashes and evidence.
  validateCollectionReview(payload, actor.id);
  try { return await commitCollection(db, actor, payload, hash); }
  catch (error) {
    // A concurrent identical request may commit while this request is checking
    // its appointment. A confirmed receipt takes precedence over that conflict.
    const committed = await existingReceipt(db, payload.id, actor.id, hash);
    if (committed) return committed;
    throw error;
  }
}
async function commitCollection(db: CollectionDatabase, actor: CollectionActor, payload: CollectionPayload, hash: string): Promise<CollectionReceipt> {
  const profileId = payload.preparation.profile.id, appointmentId = payload.preparation.appointment?.id || null;
  await requireScope(db, actor, profileId, appointmentId);
  if (payload.abc.length && !deriveMobileCapabilities(actor.role, actor.permissions).recordAbc) fail("abc_permission_denied", "Tu cuenta no permite guardar registros ABC.", 403);
  const sampledPrograms = payload.preparation.programs.filter((p) => p.targets.some((t) => capturedResult(t, payload.captures[t.id]).sampled));
  const ids = JSON.stringify([...new Set([...sampledPrograms.map((p) => p.id), ...payload.abc.flatMap((a) => a.programId ? [a.programId] : [])])]);
  const profileSnap = await snapshot(db, "personnel_profiles", "id = ?", [profileId]);
  const apptSnap = await snapshot(db, "session_appointments", "id = ?", [appointmentId || ""]);
  const pSnap = await snapshot(db, "intervention_programs", "id IN (SELECT value FROM json_each(?))", [ids]);
  const tSnap = await snapshot(db, "intervention_targets", "program_id IN (SELECT value FROM json_each(?))", [ids]);
  const sSnap = await snapshot(db, "intervention_sessions", "program_id IN (SELECT value FROM json_each(?)) AND status = 'closed'", [ids]);
  const eSnap = await snapshot(db, "target_mastery_events", "program_id IN (SELECT value FROM json_each(?))", [ids]);
  const nSnap = await snapshot(db, "session_note_templates", "id = ?", [payload.template.id]);
  const appointment = apptSnap.rows[0];
  if (profileSnap.rows[0]?.status !== "active") fail("profile_unavailable", "El perfil del niño ya no está activo.", 403);
  if (appointmentId && (!appointment || appointment.profile_id !== profileId || appointment.professional_account_id !== actor.id || !["scheduled", "in_progress"].includes(text(appointment.status)) || appointment.clinical_session_run_id || appointment.intervention_session_id)) fail("appointment_conflict", "La cita cambió. Los datos se conservan para revisión.");
  const sessionDate = collectionDateTime(payload.startedAt).date;
  if (appointment && appointment.session_date !== sessionDate) fail("appointment_date_mismatch", "La fecha de inicio de la terapia no coincide con la cita. Revisa la agenda; los datos del teléfono se conservan.");
  if (pSnap.rows.length !== JSON.parse(ids).length || pSnap.rows.some((p) => p.status !== "active" || p.profile_id !== profileId)) fail("program_conflict", "Un programa fue archivado o cambió de perfil. Solicita revisión sin borrar los datos.");
  const currentPrograms = pSnap.rows.map((p) => programFromRow(p, tSnap.rows));
  for (const current of currentPrograms) {
    const original = payload.preparation.programs.find((p) => p.id === current.id)!;
    if (!original || programDefinition(current) !== programDefinition(original)) fail("configuration_changed", "Las instrucciones cambiaron. Revisa la configuración actual antes de sincronizar.");
    for (const t of original.targets) {
      const capture = payload.captures[t.id]; if (!capture) continue;
      const target = current.targets.find((x) => x.id === t.id);
      if (!target || capture.definition !== targetDefinition(target)) fail("configuration_changed", "La medición o el criterio cambió. Revisa la configuración actual; los ensayos se conservan.");
    }
  }
  for (const a of payload.abc) if (a.targetId && !currentPrograms.find((p) => p.id === a.programId)?.targets.some((t) => t.id === a.targetId)) fail("abc_target_conflict", "El target del ABC ya no está disponible. Solicita revisión sin borrar el registro.");
  if (nSnap.rows.some((n) => n.status !== "active")) fail("template_changed", "La plantilla fue archivada. Selecciona una plantilla vigente y revisa la nota.");
  const template = templatesFromRows(nSnap.rows).find((t) => t.id === payload.template.id)!;
  if (!template || templateDefinition(template) !== templateDefinition(payload.template)) fail("template_changed", "La plantilla cambió. Revisa sus campos actuales antes de sincronizar.");
  const now = new Date().toISOString();
  const noteValues = normalizeSessionNoteValues(payload.noteValues, template.fields), noteText = formatSessionNoteText(template.fields, noteValues);
  const writes: Sql[] = [insert("clinical_session_runs", { id: payload.id, profile_id: profileId, appointment_id: appointmentId, professional_account_id: actor.id,
    session_date: sessionDate, context: payload.context.trim(), source: "mobile", duration_seconds: payload.durationSeconds, collection_snapshot: JSON.stringify(payload), payload_hash: hash,
    note_template_id: nSnap.rows[0]?.id || null, note_template_snapshot: JSON.stringify(template), note_values: JSON.stringify(noteValues), note_text: noteText,
    status: "closed", started_at: payload.startedAt, closed_at: payload.endedAt, created_at: payload.startedAt, updated_at: now })];
  const sessionIds = new Map<string, string>();
  const impacts: Array<{ targetId: string; previousDate: unknown; nextDate: string | null }> = [];
  for (const submitted of sampledPrograms) {
    const program = currentPrograms.find((p) => p.id === submitted.id)!;
    const sessionId = `${payload.id}:${program.id}`; sessionIds.set(program.id, sessionId);
    const targetMap = new Map(program.targets.map((t) => [t.id, t]));
    const replay = replayClinicalProgram(program.targets, [
      ...sSnap.rows.filter((s) => s.program_id === program.id).map((s) => ({ id: text(s.id), sessionDate: text(s.session_date), context: text(s.context), professionalAccountId: text(s.professional_account_id), createdAt: text(s.created_at),
        results: parsed<Row[]>(s.results, []).flatMap((r) => { const t = targetMap.get(text(r.targetId)); return t ? [storedResult(r, t)] : []; }) })),
      { id: sessionId, sessionDate, context: payload.context.trim(), professionalAccountId: actor.id, createdAt: payload.startedAt,
        results: submitted.targets.flatMap((t) => { const current = targetMap.get(t.id); return current ? [capturedResult(current, payload.captures[t.id])] : []; }) },
    ]);
    const result = replay.sessions.find((s) => s.id === sessionId)!;
    writes.push(insert("intervention_sessions", { id: sessionId, clinical_session_run_id: payload.id, program_id: program.id, session_date: sessionDate, context: payload.context.trim(), notes: noteText,
      status: "closed", results: JSON.stringify(result.results), transitions: JSON.stringify(result.transitions), professional_account_id: actor.id, created_at: payload.startedAt, updated_at: now, closed_at: payload.endedAt }));
    for (const s of replay.sessions.filter((s) => s.id !== sessionId)) writes.push(update("intervention_sessions", s.id, { results: JSON.stringify(s.results), transitions: JSON.stringify(s.transitions), updated_at: now }));
    writes.push({ sql: "DELETE FROM target_state_history WHERE target_id IN (SELECT id FROM intervention_targets WHERE program_id = ?)", values: [program.id] });
    for (const s of replay.sessions) for (const t of s.transitions) writes.push(insert("target_state_history", { id: crypto.randomUUID(), target_id: t.targetId, session_id: s.id, from_state: t.from, to_state: t.to, reason: t.reason, created_at: `${s.sessionDate}T23:59:59.000Z` }));
    const desired = new Map(replay.masteryEvents.map((e) => [e.targetId, e]));
    const existing = eSnap.rows.filter((e) => e.program_id === program.id);
    for (const e of existing.filter((x) => x.status === "active")) {
      const next = desired.get(text(e.target_id));
      if (!next || next.sessionId !== e.session_id || next.masteredAt !== e.mastered_at || next.method !== e.mastery_method) impacts.push({ targetId: text(e.target_id), previousDate: e.mastered_at, nextDate: next?.masteredAt || null });
      if (!next) writes.push(update("target_mastery_events", e.id, { status: "revoked", invalidated_at: now, invalidated_by_account_id: actor.id, invalidation_reason: "Revisión confirmada de una sesión móvil histórica.", updated_at: now }));
    }
    for (const e of replay.masteryEvents) {
      const old = existing.find((x) => x.target_id === e.targetId);
      const values = { program_id: program.id, session_id: e.sessionId, mastered_at: e.masteredAt, mastery_method: e.method, professional_account_id: e.professionalAccountId,
        criterion_snapshot: JSON.stringify(e.criterion), status: "active", invalidated_at: null, invalidated_by_account_id: null, invalidation_reason: "", updated_at: now };
      writes.push(old ? update("target_mastery_events", old.id, values) : insert("target_mastery_events", { id: crypto.randomUUID(), target_id: e.targetId, ...values, created_at: now }));
    }
    for (const t of program.targets) { const e = desired.get(t.id); writes.push(update("intervention_targets", t.id, { state: replay.targetStates.get(t.id) || "baseline", mastery_achieved: e ? 1 : 0, mastered_at: e?.masteredAt || null, mastery_method: e?.method || null, updated_at: now })); }
    writes.push(update("intervention_programs", program.id, { updated_at: now }));
  }
  if (impacts.length && payload.confirmHistoricalImpact !== true) fail("historical_mastery_review", "Esta sesión anterior modifica la fecha o evidencia de un dominio. Revisa y confirma el recálculo; quedará auditado.");
  const firstSession = [...sessionIds.values()][0]!;
  for (const a of payload.abc) writes.push(insert("abc_records", { id: a.id, profile_id: profileId, appointment_id: appointmentId, session_id: a.programId ? sessionIds.get(a.programId) || null : firstSession,
    program_id: a.programId, target_id: a.targetId, recorded_by_account_id: actor.id, recorded_by_name: actor.displayName, event_date: a.eventDate, event_time: a.eventTime,
    location_context: a.context, activity: a.activity, antecedent_label: a.antecedent.slice(0,160), antecedent_description: a.antecedent, behavior_label: a.behavior.slice(0,200), behavior_description: a.behavior,
    consequence_label: a.consequence.slice(0,160), consequence_description: a.consequence, additional_observation: a.note, created_at: a.at, updated_at: now }));
  if (appointmentId) writes.push(update("session_appointments", appointmentId, { clinical_session_run_id: payload.id, intervention_session_id: firstSession, status: "completed", updated_at: now }));
  writes.push(insert("clinical_data_audit", { id: crypto.randomUUID(), resource_type: "clinical_session_run", resource_id: payload.id, action: impacts.length ? "mobile_close_historical_confirmed" : "mobile_close",
    actor_account_id: actor.id, reason: "Sesión móvil sincronizada de forma atómica.", before_snapshot: JSON.stringify({ masteryImpacts: impacts }),
    after_snapshot: JSON.stringify({ payloadHash: hash, sessionIds: [...sessionIds.values()], observationCount: Object.values(payload.captures).reduce((n,c) => n + c.observations.length, 0), capturedAt: payload.endedAt, synchronizedAt: now,
      preflightTiming: payload.preflight?.timing, reviewedAt: payload.preflight?.checkedAt, signedByAccountId: actor.id, signedAt: payload.signature?.signedAt }), created_at: now }));
  const guards = [profileSnap, apptSnap, pSnap, tSnap, sSnap, eSnap, nSnap].map((s) => s.guard);
  try { await db.batch([...guards, ...writes].map((q) => db.prepare(q.sql).bind(...q.values))); }
  catch {
    const receipt = await existingReceipt(db, payload.id, actor.id, hash); if (receipt) return receipt;
    fail("sync_retry", "El servidor no confirmó el guardado completo. Los datos locales siguen intactos; se reintentará la sincronización.", 503);
  }
  return { id: payload.id, status: "closed", closedAt: payload.endedAt!, sessionIds: [...sessionIds.values()], duplicate: false };
}
