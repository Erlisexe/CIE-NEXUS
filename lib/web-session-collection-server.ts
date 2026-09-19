import {
  CollectionError,
  PREFLIGHT_ITEMS,
  activeObservations,
  collectionDateTime,
  createCollectionDraft,
  stopCollectionClocks,
  type CollectionDraft,
  type CollectionPreparation,
  type SessionClosing,
} from "./mobile-collection.ts";
import { prepareMobileCollection, type CollectionActor, type CollectionDatabase } from "./mobile-collection-server.ts";
import { deriveMobileCapabilities } from "./mobile-api-contract.ts";

type Row = Record<string, unknown>;
type StartInput = {
  profileId: string;
  appointmentId: string | null;
  sessionDate: string;
  contextCategory: string;
  contextOther: string;
  noteTemplateId: string;
  selectedTargetIds: string[];
};

const CONTEXTS = new Set(["Mesa", "Piso", "Patio", "Baño", "Comedor", "Comunidad", "Otro"]);
const text = (value: unknown) => typeof value === "string" ? value : "";
const parsed = <T>(value: unknown, fallback: T): T => { try { return typeof value === "string" ? JSON.parse(value) as T : fallback; } catch { return fallback; } };
const all = async (db: CollectionDatabase, sql: string, ...values: unknown[]) => (await db.prepare(sql).bind(...values).all<Row>()).results;
const fail = (code: string, message: string, status = 400): never => { throw new CollectionError(code, message, status); };
const isIso = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
const isUuid = (value: unknown) => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

function contextValue(input: StartInput) {
  if (!CONTEXTS.has(input.contextCategory)) fail("context_required", "Selecciona el contexto de la sesión.");
  if (input.contextCategory === "Otro") {
    const other = input.contextOther.trim();
    if (!other) fail("context_required", "Describe el contexto seleccionado como Otro.");
    return other.slice(0, 300);
  }
  return input.contextCategory;
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validClosing(value: unknown): value is SessionClosing {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const closing = value as SessionClosing;
  return typeof closing.activities === "string" && closing.activities.length <= 12000
    && typeof closing.incidents === "string" && closing.incidents.length <= 12000
    && typeof closing.guardianPresent === "boolean" && typeof closing.guardianName === "string" && closing.guardianName.length <= 300
    && typeof closing.concernPresent === "boolean" && typeof closing.concernNote === "string" && closing.concernNote.length <= 12000
    && typeof closing.coordinatorName === "string" && closing.coordinatorName.length <= 300;
}

function validateActiveDraft(raw: unknown, stored: CollectionDraft, actor: CollectionActor): CollectionDraft {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("invalid_draft", "El borrador no tiene un formato válido.");
  const draft = raw as CollectionDraft;
  if (draft.id !== stored.id || draft.status !== "active" || draft.endedAt !== null || draft.preparation.professionalAccountId !== actor.id
    || !sameJson(draft.preparation, stored.preparation) || !sameJson(draft.template, stored.template) || !sameJson(draft.preflight, stored.preflight)
    || draft.startedAt !== stored.startedAt || draft.context !== stored.context) fail("draft_conflict", "La preparación de la sesión cambió. Los datos anteriores permanecen guardados.", 409);
  if (!Number.isFinite(draft.elapsedMs) || draft.elapsedMs < 0 || draft.elapsedMs > Date.now() - Date.parse(draft.startedAt) + 300000 || (draft.runningSince !== null && !isIso(draft.runningSince))) fail("invalid_draft", "El reloj de la sesión no es válido.");
  const targetIds = new Set(draft.preparation.programs.flatMap((program) => program.targets.map((target) => target.id)));
  if (!draft.captures || typeof draft.captures !== "object" || Array.isArray(draft.captures) || Object.keys(draft.captures).some((id) => !targetIds.has(id))) fail("invalid_draft", "El borrador contiene un target ajeno a la sesión.");
  let observations = 0;
  for (const [targetId, capture] of Object.entries(draft.captures)) {
    if (!capture || capture.targetId !== targetId || typeof capture.definition !== "string" || capture.definition.length > 20000 || !Array.isArray(capture.observations) || typeof capture.note !== "string" || capture.note.length > 12000 || !Number.isInteger(capture.opportunities) || capture.opportunities < 0) fail("invalid_draft", "Un registro del target no es válido.");
    observations += capture.observations.length;
    if (observations > 10000) fail("draft_too_large", "La sesión contiene demasiados eventos; ciérrala antes de continuar.", 413);
    for (const event of capture.observations) if (!event || !isUuid(event.id) || !isIso(event.at) || !Number.isFinite(event.value) || event.value < 0 || (event.responseCode && !["I", "G", "V", "M", "FP", "FT", "X"].includes(event.responseCode))) fail("invalid_draft", "Un evento del target no es válido.");
  }
  if (!Array.isArray(draft.abc) || draft.abc.length > 1000 || draft.abc.some((item) => !item || !isUuid(item.id) || !isIso(item.at) || !item.antecedent?.trim() || !item.behavior?.trim() || !item.consequence?.trim() || !Number.isInteger(item.intensity) || Number(item.intensity) < 1 || Number(item.intensity) > 5)) fail("invalid_draft", "Revisa los registros ABC de la sesión.");
  if (!draft.noteValues || typeof draft.noteValues !== "object" || Object.entries(draft.noteValues).some(([id, value]) => !draft.template.fields.some((field) => field.id === id) || typeof value !== "string" || value.length > 12000)) fail("invalid_draft", "La nota de sesión no tiene un formato válido.");
  if (!validClosing(draft.closing)) fail("invalid_draft", "Los datos de cierre no tienen un formato válido.");
  return { ...draft, lastActiveAt: new Date().toISOString(), signature: undefined, closing: { ...draft.closing!, coordinatorSignature: undefined } };
}

export function webDraftHasData(draft: CollectionDraft) {
  return Object.values(draft.captures).some((capture) => activeObservations(capture).length > 0 || Boolean(capture.timerStartedAt) || Boolean(capture.frequencyObservationStartedAt) || (capture.frequencyObservationElapsedMs || 0) > 0 || capture.note.trim())
    || draft.abc.length > 0
    || Object.values(draft.noteValues).some((value) => value.trim())
    || Boolean(draft.closing && (draft.closing.activities.trim() || draft.closing.incidents.trim() || draft.closing.concernNote.trim() || draft.closing.guardianName.trim()));
}

async function draftRow(db: CollectionDatabase, actor: CollectionActor, profileId: string, appointmentId: string | null) {
  const rows = appointmentId
    ? await all(db, "SELECT * FROM clinical_session_runs WHERE source = 'web' AND status = 'draft' AND professional_account_id = ? AND appointment_id = ? ORDER BY updated_at DESC LIMIT 1", actor.id, appointmentId)
    : await all(db, "SELECT * FROM clinical_session_runs WHERE source = 'web' AND status = 'draft' AND professional_account_id = ? AND profile_id = ? AND appointment_id IS NULL ORDER BY updated_at DESC LIMIT 1", actor.id, profileId);
  return rows[0] || null;
}

export async function loadWebCollectionDraft(db: CollectionDatabase, actor: CollectionActor, profileId: string, appointmentId: string | null) {
  const row = await draftRow(db, actor, profileId, appointmentId);
  if (!row) return null;
  let draft = parsed<CollectionDraft>(row.collection_snapshot, null as unknown as CollectionDraft);
  if (!draft || draft.id !== row.id || draft.preparation?.professionalAccountId !== actor.id || draft.preparation?.profile?.id !== profileId || text(draft.preparation?.appointment?.id) !== text(appointmentId)) fail("draft_corrupt", "El borrador necesita revisión técnica antes de continuar.", 409);
  const hasRunningClock = Boolean(draft.runningSince) || Object.values(draft.captures).some((capture) => capture.timerStartedAt || capture.frequencyObservationStartedAt);
  if (hasRunningClock) {
    const now = Date.now();
    const activeAt = Date.parse(draft.lastActiveAt || text(row.updated_at));
    const recoveryAt = new Date(Math.min(now, Math.max(Date.parse(draft.startedAt), Number.isFinite(activeAt) ? activeAt : now))).toISOString();
    draft = { ...stopCollectionClocks(draft, recoveryAt, () => crypto.randomUUID()), lastActiveAt: new Date().toISOString() };
    try {
      await db.batch([db.prepare("UPDATE clinical_session_runs SET duration_seconds = ?, collection_snapshot = ?, updated_at = ? WHERE id = ? AND source = 'web' AND status = 'draft' AND professional_account_id = ?")
        .bind(Math.max(0, Math.round(draft.elapsedMs / 1000)), JSON.stringify(draft), draft.lastActiveAt, draft.id, actor.id)]);
    } catch { fail("draft_recovery_failed", "El borrador sigue guardado, pero no se pudo pausar de forma segura. Intenta abrirlo nuevamente.", 503); }
  }
  return draft;
}

export async function prepareWebCollection(db: CollectionDatabase, actor: CollectionActor, profileId: string, appointmentId: string | null) {
  const draft = await loadWebCollectionDraft(db, actor, profileId, appointmentId);
  if (draft) return { preparation: draft.preparation, draft };
  return { preparation: await prepareMobileCollection(db, actor, profileId, appointmentId), draft: null };
}

export type TodayCollectionAppointment = { id: string; startTime: string; endTime: string; sessionType: string; inProgress: boolean };

// Resolve today's entry using the same appointments and drafts as the calendar.
// A choice never creates a second appointment or adopts another professional's work.
export async function prepareTodayWebCollection(db: CollectionDatabase, actor: CollectionActor, profileId: string, appointmentId: string | null = null) {
  if (!deriveMobileCapabilities(actor.role, actor.permissions).recordSessions) fail("permission_denied", "Tu rol no permite registrar sesiones.", 403);
  const today = collectionDateTime(new Date()).date;
  const rows = await all(db, `SELECT a.id, a.start_time, a.end_time, a.session_type, a.status
    FROM session_appointments a JOIN personnel_profiles p ON p.id = a.profile_id
    WHERE a.profile_id = ? AND a.professional_account_id = ? AND a.session_date = ?
      AND p.status = 'active' AND a.status IN ('scheduled', 'in_progress') AND a.intervention_session_id IS NULL
      AND (a.clinical_session_run_id IS NULL OR EXISTS (
        SELECT 1 FROM clinical_session_runs r WHERE r.id = a.clinical_session_run_id
          AND r.source = 'web' AND r.status = 'draft' AND r.professional_account_id = a.professional_account_id
          AND r.profile_id = a.profile_id AND r.appointment_id = a.id))
    ORDER BY a.start_time, a.id`, profileId, actor.id, today);
  const appointments: TodayCollectionAppointment[] = rows.map((row) => ({ id: text(row.id), startTime: text(row.start_time), endTime: text(row.end_time), sessionType: text(row.session_type), inProgress: row.status === "in_progress" }));
  if (appointmentId && !appointments.some((item) => item.id === appointmentId)) fail("appointment_unavailable_today", "Esta cita ya no está disponible para tu sesión de hoy. Cierra la preparación y vuelve a abrirla desde el niño.", 409);
  if (!appointmentId && appointments.length > 1) return { appointments, preparation: null, draft: null };
  const selectedId = appointmentId || appointments[0]?.id || null;
  if (!selectedId && actor.role === "terapeuta") fail("appointment_required_today", "No tienes una cita disponible para hoy con este niño. Revisa su asignación con coordinación.", 409);
  // Existing rules still govern ad hoc sessions for other roles and assigned children.
  return { appointments: [], ...await prepareWebCollection(db, actor, profileId, selectedId) };
}

export async function startWebCollection(db: CollectionDatabase, actor: CollectionActor, raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("invalid_start", "No se pudo preparar la sesión.");
  const body = raw as Record<string, unknown>;
  const input: StartInput = {
    profileId: text(body.profileId).trim(),
    appointmentId: text(body.appointmentId).trim() || null,
    sessionDate: text(body.sessionDate).trim(),
    contextCategory: text(body.contextCategory).trim(),
    contextOther: text(body.contextOther).trim(),
    noteTemplateId: text(body.noteTemplateId).trim(),
    selectedTargetIds: Array.isArray(body.selectedTargetIds) ? [...new Set(body.selectedTargetIds.map((id) => text(id).trim()).filter(Boolean))] : [],
  };
  if (!input.profileId || !/^\d{4}-\d{2}-\d{2}$/.test(input.sessionDate) || !input.selectedTargetIds.length || input.selectedTargetIds.length > 100) fail("invalid_start", "Selecciona niño, fecha y al menos un target.");
  const resumed = await loadWebCollectionDraft(db, actor, input.profileId, input.appointmentId);
  if (resumed) return { draft: resumed, resumed: true };
  const prepared = await prepareMobileCollection(db, actor, input.profileId, input.appointmentId);
  const institutionalDate = collectionDateTime(new Date()).date;
  if (prepared.appointment && prepared.appointment.sessionDate !== institutionalDate) fail("appointment_not_today", "La toma real sólo puede iniciarse en la fecha programada de la cita.", 409);
  if (!prepared.appointment && input.sessionDate !== institutionalDate) fail("session_date_not_today", "La toma real debe registrarse con la fecha institucional de hoy.", 409);
  const availableTargets = new Map(prepared.programs.flatMap((program) => program.targets.map((target) => [target.id, target] as const)));
  if (input.selectedTargetIds.some((id) => !availableTargets.has(id))) fail("target_unavailable", "Uno de los targets ya no está disponible.", 409);
  const selectedTargets = input.selectedTargetIds.map((id) => availableTargets.get(id)!);
  const earlyMaintenance = selectedTargets.find((target) => target.state === "maintenance" && target.maintenanceDue === false);
  if (earlyMaintenance) fail("maintenance_not_due", `${earlyMaintenance.code} · ${earlyMaintenance.name} todavía no corresponde a sonda de mantenimiento.`, 409);
  const template = prepared.templates.find((item) => item.id === input.noteTemplateId) || prepared.templates[0];
  if (!template) fail("template_missing", "No hay una plantilla de nota disponible.", 409);
  const preparation: CollectionPreparation = { ...prepared, sessionDate: prepared.appointment?.sessionDate || input.sessionDate,
    programs: prepared.programs.map((program) => ({ ...program, targets: program.targets.filter((target) => input.selectedTargetIds.includes(target.id)) })).filter((program) => program.targets.length), templates: [template] };
  const now = new Date().toISOString();
  const draft = createCollectionDraft(preparation, crypto.randomUUID(), now);
  draft.context = contextValue(input);
  draft.template = template;
  draft.noteValues = Object.fromEntries(template.fields.map((field) => [field.id, ""]));
  draft.preflight = { version: 1, accountId: actor.id, profileId: input.profileId, checkedAt: now, timing: "before_start", checks: Object.fromEntries(PREFLIGHT_ITEMS.map((item) => [item.id, true])) as Record<typeof PREFLIGHT_ITEMS[number]["id"], boolean> };
  const [storedTemplate] = await all(db, "SELECT id FROM session_note_templates WHERE id = ? AND status = 'active'", template.id);
  const appointmentGuard = input.appointmentId
    ? db.prepare("SELECT json(CASE WHEN EXISTS(SELECT 1 FROM session_appointments WHERE id = ? AND professional_account_id = ? AND profile_id = ? AND status = 'scheduled' AND clinical_session_run_id IS NULL AND intervention_session_id IS NULL) THEN 'true' ELSE 'appointment_conflict' END)").bind(input.appointmentId, actor.id, input.profileId)
    : db.prepare("SELECT json('true')");
  const writes = [appointmentGuard,
    db.prepare("INSERT INTO clinical_session_runs(id,profile_id,appointment_id,professional_account_id,session_date,context,source,duration_seconds,collection_snapshot,payload_hash,note_template_id,note_template_snapshot,note_values,note_text,status,started_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(draft.id, input.profileId, input.appointmentId, actor.id, preparation.sessionDate, draft.context, "web", 0, JSON.stringify(draft), "", storedTemplate?.id || null, JSON.stringify(template), JSON.stringify(draft.noteValues), "", "draft", now, now, now)];
  if (input.appointmentId) writes.push(db.prepare("UPDATE session_appointments SET status = 'in_progress', clinical_session_run_id = ?, updated_at = ? WHERE id = ?").bind(draft.id, now, input.appointmentId));
  try { await db.batch(writes); }
  catch { fail("draft_start_failed", "No se pudo abrir el borrador persistente. Intenta nuevamente.", 503); }
  return { draft, resumed: false };
}

export async function saveWebCollectionDraft(db: CollectionDatabase, actor: CollectionActor, raw: unknown) {
  const id = raw && typeof raw === "object" && !Array.isArray(raw) ? text((raw as CollectionDraft).id) : "";
  const [row] = id ? await all(db, "SELECT * FROM clinical_session_runs WHERE id = ?", id) : [];
  if (!row || row.source !== "web" || row.status !== "draft" || row.professional_account_id !== actor.id) fail("draft_missing", "No se encontró el borrador activo.", 404);
  const stored = parsed<CollectionDraft>(row.collection_snapshot, null as unknown as CollectionDraft);
  if (!stored) fail("draft_corrupt", "El borrador necesita revisión técnica.", 409);
  const draft = validateActiveDraft(raw, stored, actor);
  const now = new Date().toISOString();
  try { await db.batch([db.prepare("UPDATE clinical_session_runs SET duration_seconds = ?, collection_snapshot = ?, note_values = ?, updated_at = ? WHERE id = ? AND source = 'web' AND status = 'draft' AND professional_account_id = ?")
    .bind(Math.max(0, Math.round(draft.elapsedMs / 1000)), JSON.stringify(draft), JSON.stringify(draft.noteValues), now, draft.id, actor.id)]); }
  catch { fail("draft_save_failed", "No se confirmó el guardado. Los datos siguen visibles para reintentar.", 503); }
  return { savedAt: now };
}

export async function discardWebCollectionDraft(db: CollectionDatabase, actor: CollectionActor, id: string) {
  const [row] = id ? await all(db, "SELECT * FROM clinical_session_runs WHERE id = ?", id) : [];
  if (!row || row.source !== "web" || row.status !== "draft" || row.professional_account_id !== actor.id) fail("draft_missing", "No se encontró el borrador activo.", 404);
  const draft = parsed<CollectionDraft>(row.collection_snapshot, null as unknown as CollectionDraft);
  if (!draft) fail("draft_corrupt", "El borrador necesita revisión técnica.", 409);
  if (webDraftHasData(draft)) fail("draft_has_data", "La sesión ya contiene datos clínicos. Debes cerrarla; no se puede descartar.", 409);
  const now = new Date().toISOString();
  const writes = [];
  if (row.appointment_id) writes.push(db.prepare("UPDATE session_appointments SET status = 'scheduled', clinical_session_run_id = NULL, updated_at = ? WHERE id = ? AND clinical_session_run_id = ? AND intervention_session_id IS NULL").bind(now, row.appointment_id, id));
  writes.push(db.prepare("DELETE FROM clinical_session_runs WHERE id = ? AND source = 'web' AND status = 'draft' AND professional_account_id = ?").bind(id, actor.id));
  writes.push(db.prepare("INSERT INTO clinical_data_audit(id,resource_type,resource_id,action,actor_account_id,reason,before_snapshot,after_snapshot,created_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .bind(crypto.randomUUID(), "clinical_session_run", id, "web_discard_empty", actor.id, "Borrador web vacío descartado.", JSON.stringify({ appointmentId: row.appointment_id || null }), "{}", now));
  try { await db.batch(writes); }
  catch { fail("draft_discard_failed", "No se pudo descartar la sesión vacía.", 503); }
  return { discarded: true };
}
