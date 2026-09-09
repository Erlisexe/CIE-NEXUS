import { normalizeCriteria, normalizeTargetState, type ClinicalSessionResult, type TargetCriteria, type TargetState } from "./clinical-mastery.ts";
import { missingRequiredSessionNoteFields, type SessionNoteTemplateSnapshot } from "./session-note-templates.ts";

export type CollectionTarget = { id: string; code: string; name: string; measurement: string; unitLabel: string; specificObjective: string; state: TargetState; criteria: TargetCriteria };
export type CollectionProgram = { id: string; name: string; objective: string; instructions: string; targets: CollectionTarget[] };
export type CollectionPreparation = {
  profile: { id: string; fullName: string; site: string };
  appointment: { id: string; sessionDate: string; startTime: string; endTime: string; notes: string } | null;
  professionalAccountId: string; programs: CollectionProgram[]; templates: SessionNoteTemplateSnapshot[]; canRecordAbc: boolean; preparedAt: string;
};
export type Observation = { id: string; at: string; value: number; removedAt?: string; replaces?: string };
export type TargetCapture = { targetId: string; definition: string; observations: Observation[]; note: string; opportunities: number; timerStartedAt: string | null };
export type CollectionAbc = { id: string; at: string; eventDate: string; eventTime: string; programId: string | null; targetId: string | null; antecedent: string; behavior: string; consequence: string; context: string; activity: string; note: string };
export const PREFLIGHT_ITEMS = [
  { id: "identity", label: "Confirmé la identidad del niño y su cita." },
  { id: "programs", label: "Revisé los programas, las instrucciones y los criterios vigentes." },
  { id: "materials", label: "Preparé los materiales y el contexto para esta sesión." },
] as const;
export type SessionPreflight = { version: 1; accountId: string; profileId: string; checkedAt: string; timing: "before_start" | "recovered_draft"; checks: Record<typeof PREFLIGHT_ITEMS[number]["id"], boolean> };
export type SignaturePoint = { x: number; y: number };
export type SessionSignature = { version: 1; accountId: string; name: string; signedAt: string; attested: true; strokes: SignaturePoint[][] };
export type CollectionDraft = {
  id: string; preparation: CollectionPreparation; startedAt: string; endedAt: string | null;
  elapsedMs: number; runningSince: string | null; context: string; captures: Record<string, TargetCapture>; abc: CollectionAbc[];
  template: SessionNoteTemplateSnapshot; noteValues: Record<string, string>; status: "active" | "pending" | "conflict" | "synced";
  syncError: string; syncErrorCode: string; syncedAt: string | null; confirmHistoricalImpact: boolean; lastActiveAt: string;
  preflight?: SessionPreflight; signature?: SessionSignature;
};
export type CollectionReceipt = { id: string; status: "closed"; closedAt: string; sessionIds: string[]; duplicate: boolean };
export class CollectionError extends Error {
  code: string; status: number;
  constructor(code: string, message: string, status = 400) { super(message); this.code = code; this.status = status; }
}
export const isDiscrete = (measurement: string) => ["percentage", "occurrence", "discrete_trials"].includes(measurement);
export function collectionDateTime(at: string | Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Managua", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at));
  const part = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, time: `${part("hour")}:${part("minute")}` };
}
export const activeObservations = (capture: TargetCapture) => capture.observations.filter((item) => !item.removedAt).sort((a,b) => a.at.localeCompare(b.at));
export function targetDefinition(t: CollectionTarget) { return JSON.stringify([t.id, t.code, t.name, t.specificObjective, t.measurement, t.unitLabel, normalizeCriteria(t.criteria, t.measurement)]); }
export function programDefinition(p: CollectionProgram) { return JSON.stringify([p.id, p.name, p.objective, p.instructions]); }
export function templateDefinition(t: SessionNoteTemplateSnapshot) { return JSON.stringify([t.id, t.name, t.description, t.fields.map((f) => [f.id, f.label, f.guidance, f.required])]); }
export function createCollectionDraft(preparation: CollectionPreparation, id: string, at: string): CollectionDraft {
  if (!preparation.templates.length) throw new CollectionError("template_missing", "No hay una plantilla de nota disponible.");
  return { id, preparation, startedAt: at, endedAt: null, elapsedMs: 0, runningSince: at, context: preparation.profile.site || "", captures: {}, abc: [],
    template: preparation.templates[0]!, noteValues: {}, status: "active", syncError: "", syncErrorCode: "", syncedAt: null, confirmHistoricalImpact: false, lastActiveAt: at };
}
export function capturedResult(target: CollectionTarget, capture?: TargetCapture): ClinicalSessionResult {
  const events = capture ? activeObservations(capture) : [];
  const sampled = events.length > 0;
  const trials = isDiscrete(target.measurement) ? events.map((e) => e.value as 0 | 1) : [];
  const correct = trials.length ? trials.reduce<number>((n, v) => n + v, 0) : null;
  // Both timers retain the web collector's accumulated measurement in seconds.
  const value = !sampled ? null : trials.length ? Math.round(correct! / trials.length * 1000) / 10 : events.reduce((n, e) => n + e.value, 0);
  return { targetId: target.id, sampled, value, correct, opportunities: trials.length || (sampled ? capture!.opportunities : 0), trials, note: capture?.note || "",
    stateAtSession: normalizeTargetState(target.state), criterionStatus: "not_evaluated", criterionReason: "" };
}
export function stopCollectionClocks(draft: CollectionDraft, at: string, makeId: () => string): CollectionDraft {
  const end = Date.parse(at);
  const captures = Object.fromEntries(Object.entries(draft.captures).map(([id, c]) => !c.timerStartedAt ? [id, c] : [id, { ...c, timerStartedAt: null, opportunities: Math.max(1, c.opportunities),
    observations: [...c.observations, { id: makeId(), at, value: Math.max(0, Math.round((end - Date.parse(c.timerStartedAt)) / 1000)) }] }]));
  return { ...draft, captures, runningSince: null, elapsedMs: draft.elapsedMs + (draft.runningSince ? Math.max(0, end - Date.parse(draft.runningSince)) : 0) };
}
export function closeCollectionDraft(draft: CollectionDraft, at: string, makeId: () => string): CollectionDraft {
  if (draft.status === "pending" || draft.status === "synced") throw new CollectionError("immutable_submission", "La sesión ya fue enviada. Conserva su contenido mientras se confirma el resultado.");
  const stopped = stopCollectionClocks(draft, at, makeId);
  if (!stopped.context.trim()) throw new CollectionError("context_required", "Indica el contexto de la sesión.");
  const missing = missingRequiredSessionNoteFields(stopped.template.fields, stopped.noteValues);
  if (missing.length) throw new CollectionError("note_required", `Completa la nota: ${missing.map((f) => f.label).join(", ")}.`);
  if (stopped.abc.some((a) => !a.antecedent.trim() || !a.behavior.trim() || !a.consequence.trim())) throw new CollectionError("abc_required", "Completa antecedente, conducta y consecuencia de cada Registro ABC iniciado.");
  if (!stopped.preparation.programs.some((p) => p.targets.some((t) => capturedResult(t, stopped.captures[t.id]).sampled))) throw new CollectionError("data_required", "Registra al menos un resultado. Un cero observado también es un resultado.");
  const closed: CollectionDraft = { ...stopped, endedAt: draft.endedAt || at, status: "pending", syncError: "", syncErrorCode: "" };
  validateCollectionReview(collectionPayload(closed), draft.preparation.professionalAccountId);
  return closed;
}
export function reviewCollectionConfiguration(draft: CollectionDraft, fresh: CollectionPreparation): CollectionDraft {
  if (draft.status !== "conflict" || !draft.endedAt || draft.runningSince) throw new CollectionError("immutable_submission", "Solo se puede revisar un cierre rechazado por el servidor.");
  const old = draft.preparation;
  if (old.profile.id !== fresh.profile.id || old.professionalAccountId !== fresh.professionalAccountId || old.appointment?.id !== fresh.appointment?.id) throw new CollectionError("configuration_changed", "La configuración no corresponde a esta sesión.");
  if (!fresh.templates.length) throw new CollectionError("template_missing", "No hay una plantilla de nota disponible.");
  const captures = Object.fromEntries(Object.entries(draft.captures).map(([id, capture]) => {
    const before = old.programs.flatMap((p) => p.targets).find((t) => t.id === id);
    const after = fresh.programs.flatMap((p) => p.targets).find((t) => t.id === id);
    const sameProgram = old.programs.find((p) => p.targets.some((t) => t.id === id))?.id === fresh.programs.find((p) => p.targets.some((t) => t.id === id))?.id;
    if (!before || !after || !sameProgram || before.measurement !== after.measurement || before.unitLabel !== after.unitLabel || capture.timerStartedAt) throw new CollectionError("configuration_changed", "Cambió o se retiró una medición. Dirección Clínica debe revisar la configuración; los registros originales se conservan.");
    return [id, { ...capture, definition: targetDefinition(after) }];
  }));
  if (draft.abc.some((a) => a.programId && !fresh.programs.some((p) => p.id === a.programId && (!a.targetId || p.targets.some((t) => t.id === a.targetId))))) throw new CollectionError("configuration_changed", "Un programa o target del ABC ya no está disponible. Se conserva el registro para revisión.");
  return { ...draft, preparation: fresh, captures, template: fresh.templates.find((t) => t.id === draft.template.id) || fresh.templates[0]!,
    signature: undefined, confirmHistoricalImpact: false, syncErrorCode: "session_review_required", syncError: "Revisa la nota con la configuración vigente y vuelve a firmar. Se conservan los tiempos y registros originales." };
}
export function collectionPayload(draft: CollectionDraft) {
  return { id: draft.id, preparation: draft.preparation, startedAt: draft.startedAt, endedAt: draft.endedAt, durationSeconds: Math.round(draft.elapsedMs / 1000), context: draft.context,
    captures: draft.captures, abc: draft.abc, template: draft.template, noteValues: draft.noteValues, confirmHistoricalImpact: draft.confirmHistoricalImpact,
    ...(draft.preflight ? { preflight: draft.preflight } : {}), ...(draft.signature ? { signature: draft.signature } : {}) };
}
export type CollectionPayload = ReturnType<typeof collectionPayload>;
export function validateCollectionReview(body: CollectionPayload, actorId: string) {
  const fail = (message: string): never => { throw new CollectionError("session_review_required", message, 409); };
  const pre = body.preflight, signature = body.signature;
  if (!pre || pre.version !== 1 || pre.accountId !== actorId || pre.profileId !== body.preparation.profile.id || !pre.checks || PREFLIGHT_ITEMS.some((item) => pre.checks[item.id] !== true)) fail("Completa el checklist de la sesión. Los registros anteriores se conservan para revisión.");
  const checked = Date.parse(pre!.checkedAt), signed = Date.parse(signature?.signedAt || "");
  if (!Number.isFinite(checked) || !["before_start", "recovered_draft"].includes(pre!.timing) || (pre!.timing === "before_start" && checked > Date.parse(body.startedAt) + 1000)) fail("La revisión previa no corresponde al inicio de esta sesión.");
  if (!signature || signature.version !== 1 || signature.accountId !== actorId || typeof signature.name !== "string" || !signature.name.trim() || signature.name.length > 200 || signature.attested !== true || !Number.isFinite(signed) || signed < checked || signed < Date.parse(body.endedAt!) - 2000 || signed > Date.now() + 300000) fail("Firma el cierre con la cuenta del profesional que registró la sesión.");
  if (!Array.isArray(signature!.strokes) || signature!.strokes.length > 80) fail("Vuelve a trazar la firma del profesional.");
  let points = 0, distance = 0;
  for (const stroke of signature!.strokes) {
    if (!Array.isArray(stroke)) fail("La firma no tiene un formato válido.");
    for (let i = 0; i < stroke.length; i++) {
      const p = stroke[i]!; points++;
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || points > 1200) fail("La firma no tiene un formato válido.");
      if (i) distance += Math.hypot(p.x - stroke[i - 1]!.x, p.y - stroke[i - 1]!.y);
    }
  }
  if (points < 3 || distance < 0.08) fail("Traza tu firma antes de cerrar la sesión.");
}
export function validateCollectionPayload(raw: unknown): CollectionPayload {
  const fail = (message: string): never => { throw new CollectionError("invalid_collection", message); };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("La sesión no tiene un formato válido.");
  const body = raw as CollectionPayload;
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const at = (v: unknown) => typeof v === "string" && Number.isFinite(Date.parse(v));
  const str = (v: unknown, max: number, required = false) => typeof v === "string" && v.length <= max && (!required || Boolean(v.trim()));
  if (!uuid.test(body.id) || !at(body.startedAt) || !at(body.endedAt) || Date.parse(body.endedAt!) < Date.parse(body.startedAt)) fail("Revisa el inicio y el cierre de la sesión.");
  if (Date.parse(body.endedAt!) > Date.now() + 300000) fail("La hora de cierre está en el futuro. Revisa la hora del teléfono.");
  if (!Number.isInteger(body.durationSeconds) || body.durationSeconds < 0 || body.durationSeconds > (Date.parse(body.endedAt!) - Date.parse(body.startedAt)) / 1000 + 2) fail("La duración no coincide con el intervalo registrado.");
  if (!str(body.context, 1000, true) || !body.preparation || !str(body.preparation.profile?.id, 100, true) || !str(body.preparation.professionalAccountId, 100, true)) fail("Selecciona niño, profesional y contexto.");
  if (!Array.isArray(body.preparation.programs) || !body.preparation.programs.length || body.preparation.programs.length > 200) fail("La preparación no contiene programas válidos.");
  if (!body.template || !Array.isArray(body.template.fields) || !body.template.fields.length || body.template.fields.length > 30 || !body.noteValues || typeof body.noteValues !== "object") fail("Selecciona una plantilla de nota válida.");
  if (body.template.fields.some((f) => !f || !str(f.id, 80, true) || !str(f.label, 120, true) || !str(f.guidance, 500) || typeof f.required !== "boolean")) fail("La plantilla contiene campos inválidos.");
  if (body.template.fields.some((f) => !str(body.noteValues[f.id] ?? "", 12000))) fail("La nota excede el tamaño permitido por campo.");
  const missing = missingRequiredSessionNoteFields(body.template.fields, body.noteValues);
  if (missing.length) fail(`Completa los campos obligatorios: ${missing.map((f) => f.label).join(", ")}.`);
  if (!body.captures || typeof body.captures !== "object" || Array.isArray(body.captures)) fail("Los registros no tienen un formato válido.");
  const targetIds = new Set<string>(), programIds = new Set<string>(), eventIds = new Set<string>();
  for (const p of body.preparation.programs) {
    if (!p || !str(p.id, 100, true) || programIds.has(p.id) || !Array.isArray(p.targets)) fail("Hay programas duplicados o inválidos.");
    programIds.add(p.id);
    for (const t of p.targets) {
      if (!t || !str(t.id, 100, true) || targetIds.has(t.id) || !["percentage", "occurrence", "discrete_trials", "frequency", "duration", "latency"].includes(t.measurement)) fail("Hay targets duplicados o inválidos.");
      targetIds.add(t.id);
      const c = body.captures[t.id]; if (!c) continue;
      if (c.targetId !== t.id || !str(c.definition, 20000, true) || !Array.isArray(c.observations) || !str(c.note, 12000) || c.timerStartedAt !== null || !Number.isInteger(c.opportunities) || c.opportunities < 0) fail("Detén los cronómetros y revisa los registros del target.");
      if (c.definition !== targetDefinition(t)) fail("La definición de la medición no coincide con la preparación.");
      for (const e of c.observations) {
        if (!e || !uuid.test(e.id) || eventIds.has(e.id) || !at(e.at) || !Number.isFinite(e.value) || e.value < 0 || (e.removedAt && !at(e.removedAt))) fail("Un registro es inválido o está duplicado.");
        if (Date.parse(e.at) < Date.parse(body.startedAt) || Date.parse(e.at) > Date.parse(body.endedAt!) + 1000) fail("Un registro está fuera del horario de la sesión.");
        if (isDiscrete(t.measurement) && e.value !== 0 && e.value !== 1) fail("Los ensayos discretos sólo admiten 1 o 0.");
        if (t.measurement === "frequency" && !Number.isInteger(e.value)) fail("La frecuencia debe ser un número entero.");
        eventIds.add(e.id);
      }
    }
  }
  if (Object.keys(body.captures).some((id) => !targetIds.has(id))) fail("Hay datos de un target ajeno a la sesión.");
  if (!Array.isArray(body.abc) || body.abc.length > 1000) fail("Los registros ABC no tienen un formato válido.");
  for (const a of body.abc) {
    if (!a || !uuid.test(a.id) || eventIds.has(a.id) || !at(a.at) || !/^\d{4}-\d{2}-\d{2}$/.test(a.eventDate) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.eventTime)) fail("Revisa la fecha y hora del ABC.");
    const abcDate = new Date(`${a.eventDate}T12:00:00Z`);
    if (!Number.isFinite(abcDate.getTime()) || abcDate.toISOString().slice(0,10) !== a.eventDate || Date.parse(a.at) < Date.parse(body.startedAt) || Date.parse(a.at) > Date.parse(body.endedAt!)) fail("El ABC está fuera del horario registrado.");
    const recorded = collectionDateTime(a.at);
    if (a.eventDate !== recorded.date || a.eventTime !== recorded.time) fail("La fecha y hora del ABC no corresponden al evento registrado en Nicaragua.");
    if (![a.antecedent, a.behavior, a.consequence].every((s) => str(s, 2000, true)) || !str(a.context, 300) || !str(a.activity, 300) || !str(a.note, 3000)) fail("Completa antecedente, conducta y consecuencia con hechos observables.");
    if (a.programId && !programIds.has(a.programId)) fail("El programa del ABC no corresponde al niño.");
    if (a.targetId && !body.preparation.programs.find((p) => p.id === a.programId)?.targets.some((t) => t.id === a.targetId)) fail("El target del ABC no corresponde al programa.");
    eventIds.add(a.id);
  }
  if (!body.preparation.programs.some((p) => p.targets.some((t) => capturedResult(t, body.captures[t.id]).sampled))) fail("La sesión no contiene resultados observados.");
  return body;
}
