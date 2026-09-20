"use client";

import { clientRequest } from "../../lib/client-request";
import { createLatestSaveQueue } from "../../lib/latest-save-queue";

import ModalLayer from "./modal-layer";

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  Grid3X3,
  ListTree,
  LoaderCircle,
  NotebookPen,
  Pause,
  Play,
  RotateCcw,
  Save,
  ShieldAlert,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
import {
  CollectionError,
  activeObservations,
  capturedResult,
  closeCollectionDraft,
  collectionDateTime,
  collectionPayload,
  isDuplicateTrialTap,
  isDiscrete,
  stopCollectionClocks,
  targetDefinition,
  voidLastObservation,
  type CollectionAbc,
  type CollectionDraft,
  type CollectionPreparation,
  type CollectionTarget,
  type SessionSignature,
  type SignaturePoint,
  type TargetCapture,
} from "../../lib/mobile-collection";
import { evaluateResult, targetStateLabel, type TrialResponseCode } from "../../lib/clinical-mastery";
import { sessionCloseRequirement, sessionStartRequirement } from "../../lib/session-action-feedback";

export type SessionSetupValue = {
  profileId: string;
  sessionDate: string;
  contextCategory: string;
  contextOther: string;
  noteTemplateId: string;
  selectedTargetIds: string[];
};

const CONTEXTS = ["Mesa", "Piso", "Patio", "Baño", "Comedor", "Comunidad", "Otro"] as const;
const TRIAL_RESPONSES: Array<{ code: TrialResponseCode; label: string; tone: string }> = [
  { code: "I", label: "Independiente", tone: "independent" },
  { code: "G", label: "Gestual", tone: "prompt" },
  { code: "V", label: "Verbal", tone: "prompt" },
  { code: "M", label: "Modelado", tone: "prompt" },
  { code: "FP", label: "Física parcial", tone: "prompt" },
  { code: "FT", label: "Física total", tone: "prompt" },
  { code: "X", label: "Incorrecto", tone: "incorrect" },
];

function formatElapsed(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function responseLabel(code: TrialResponseCode | null | undefined) {
  return TRIAL_RESPONSES.find((item) => item.code === code)?.label || "Sin registro previo";
}

function measurementLabel(measurement: string) {
  return ({
    percentage: "Ensayos",
    occurrence: "Ensayos discretos",
    discrete_trials: "Ensayos discretos",
    frequency: "Frecuencia",
    duration: "Duración",
    latency: "Latencia",
    partial_interval: "Intervalo parcial",
    task_analysis: "Análisis de tarea",
  } as Record<string, string>)[measurement] || measurement;
}

function targetCapture(target: CollectionTarget): TargetCapture {
  return { targetId: target.id, definition: targetDefinition(target), observations: [], note: "", opportunities: 0, timerStartedAt: null, frequencyObservationStartedAt: null, frequencyObservationElapsedMs: 0 };
}

function hasDraftData(draft: CollectionDraft) {
  return Object.values(draft.captures).some((capture) => activeObservations(capture).length || capture.timerStartedAt || capture.frequencyObservationStartedAt || (capture.frequencyObservationElapsedMs || 0) > 0 || capture.note.trim())
    || draft.abc.length > 0 || Object.values(draft.noteValues).some((value) => value.trim())
    || Boolean(draft.closing && (draft.closing.activities.trim() || draft.closing.incidents.trim() || draft.closing.guardianName.trim() || draft.closing.concernNote.trim()));
}

function targetStatus(target: CollectionTarget, capture?: TargetCapture) {
  const result = capturedResult(target, capture);
  const criterion = target.criteria[target.state as Exclude<typeof target.state, "closed">];
  const evaluation = criterion ? evaluateResult(result, criterion) : { status: "not_evaluated" as const, value: result.value, reason: "" };
  const minimumMet = Boolean(criterion && result.opportunities >= criterion.minTrials);
  return { result, criterion, evaluation, minimumMet };
}

function resultText(target: CollectionTarget, capture?: TargetCapture) {
  const { result } = targetStatus(target, capture);
  if (!result.sampled || result.value === null) return "Sin dato";
  if (isDiscrete(target.measurement)) return `${result.correct || 0}/${result.opportunities} · ${result.value}%`;
  if (target.measurement === "frequency") return `${result.value} ocurrencias${result.ratePerMinute !== null && result.ratePerMinute !== undefined ? ` · ${result.ratePerMinute}/min` : ""}`;
  return `${formatElapsed(result.value)} acumulado`;
}

export function RealSessionSetup({
  preparation,
  loading,
  value,
  starting,
  error = "",
  actionError = "",
  onRetry,
  profileOptions = [],
  onChange,
  onClose,
  onStart,
}: {
  preparation: CollectionPreparation | null;
  loading: boolean;
  value: SessionSetupValue;
  starting: boolean;
  error?: string;
  actionError?: string;
  onRetry?: () => void;
  profileOptions?: Array<{ id: string; label: string }>;
  onChange: (value: SessionSetupValue) => void;
  onClose: () => void;
  onStart: () => void;
}) {
  const targets = preparation?.programs.flatMap((program) => program.targets.map((target) => ({ ...target, programName: program.name }))) || [];
  const selected = new Set(value.selectedTargetIds);
  const acquisitionCount = targets.filter((target) => target.state === "acquisition" && selected.has(target.id)).length;
  const alerts = preparation?.profile.clinicalAlerts;
  const startRequirement = sessionStartRequirement({
    loading,
    starting,
    hasPreparation: Boolean(preparation),
    selectedTargetCount: selected.size,
    contextCategory: value.contextCategory,
    contextOther: value.contextOther,
    appointmentDate: preparation?.appointment?.sessionDate,
    institutionalDate: collectionDateTime(new Date()).date,
  });
  const startDisabled = loading || starting || !preparation || Boolean(startRequirement);
  function toggle(target: CollectionTarget) {
    if (target.state === "maintenance" && target.maintenanceDue === false) return;
    onChange({ ...value, selectedTargetIds: selected.has(target.id) ? value.selectedTargetIds.filter((id) => id !== target.id) : [...value.selectedTargetIds, target.id] });
  }
  return <ModalLayer onDismiss={onClose} dismissDisabled={starting} className="modal-backdrop real-setup-backdrop"><section className="real-session-setup" role="dialog" aria-modal="true" aria-labelledby="real-session-setup-title">
    <header><div><p className="section-kicker">Antes de empezar</p><h2 id="real-session-setup-title">Preparar toma de sesión</h2>{preparation?.profile && <span>{preparation.profile.fullName} · {preparation.profile.site}</span>}</div><button aria-label="Cerrar preparación" disabled={starting} onClick={onClose}><X size={20}/></button></header>
    {error ? <div className="load-error" role="alert"><p>{error}</p><button onClick={onRetry}>Reintentar carga</button></div> : loading ? <div className="real-setup-loading" role="status"><LoaderCircle className="spin" size={27}/><strong>Revisando expediente, agenda y targets…</strong></div> : !preparation ? <div className="load-error"><p>No hay un niño disponible con targets abiertos para preparar esta sesión.</p></div> : <div className="real-setup-content">
      <section className="clinical-alert-grid" aria-label="Información clínica previa"><article className={alerts?.allergies ? "warning" : ""}><ShieldAlert size={19}/><div><small>Alergias</small><strong>{alerts?.allergies || "No registradas"}</strong></div></article><article><FileText size={19}/><div><small>Medicamentos</small><strong>{alerts?.medications || "No registrados"}</strong></div></article><article className="reinforcers"><CheckCircle2 size={19}/><div><small>Refuerzos / preferencias</small><strong>{alerts?.reinforcers || "No registrados"}</strong></div></article></section>
      <section className="real-setup-context"><div><strong>Contexto de hoy</strong><small>Selecciona el lugar principal de la toma.</small></div><div role="radiogroup" aria-label="Contexto de la sesión">{CONTEXTS.map((context) => <button type="button" role="radio" tabIndex={value.contextCategory === context || (!value.contextCategory && context === CONTEXTS[0]) ? 0 : -1} onKeyDown={(event) => { const offset = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1 : 0; if (!offset) return; event.preventDefault(); const next = (CONTEXTS.indexOf(context) + offset + CONTEXTS.length) % CONTEXTS.length; onChange({ ...value, contextCategory: CONTEXTS[next] }); (event.currentTarget.parentElement?.children[next] as HTMLElement)?.focus(); }} aria-checked={value.contextCategory === context} className={value.contextCategory === context ? "active" : ""} key={context} onClick={() => onChange({ ...value, contextCategory: context })}>{context}</button>)}</div>{value.contextCategory === "Otro" && <label><span>Describe el contexto</span><input autoFocus value={value.contextOther} onChange={(event) => onChange({ ...value, contextOther: event.target.value })} placeholder="Contexto observado"/></label>}</section>
      <section className="real-target-selection"><div className="real-target-selection-heading"><div><strong>Targets que se tomarán hoy</strong><small>{selected.size} seleccionados de {targets.length} disponibles</small></div>{acquisitionCount > 5 && <span><AlertTriangle size={15}/> Hay {acquisitionCount} targets en adquisición; revisa si la carga es viable.</span>}</div><div className="real-target-selection-list">{preparation.programs.map((program) => <section key={program.id}><header><strong>{program.name}</strong><small>{program.targets.length} targets abiertos</small></header>{program.targets.map((target) => { const unavailable = target.state === "maintenance" && target.maintenanceDue === false; return <label className={`${selected.has(target.id) ? "selected" : ""} ${unavailable ? "unavailable" : ""}`} key={target.id}><input type="checkbox" checked={selected.has(target.id)} disabled={unavailable} onChange={() => toggle(target)}/><span><strong>{target.code} · {target.name}</strong><small>{targetStateLabel(target.state)} · {measurementLabel(target.measurement)} · última ayuda: {responseLabel(target.lastPromptCode)}</small>{unavailable && <em>Sonda disponible {target.maintenanceDueDate || "según programación"}</em>}</span></label>; })}</section>)}</div></section>
      <section className="real-setup-note"><label><span>Niño</span><select disabled={Boolean(preparation.appointment)} value={value.profileId} onChange={(event) => onChange({ ...value, profileId: event.target.value, selectedTargetIds: [] })}>{profileOptions.map((profile) => <option value={profile.id} key={profile.id}>{profile.label}</option>)}</select></label><label><span>Plantilla de nota</span><select value={value.noteTemplateId} onChange={(event) => onChange({ ...value, noteTemplateId: event.target.value })}>{preparation.templates.map((template) => <option value={template.id || ""} key={template.id || template.name}>{template.name}</option>)}</select></label><label><span>Fecha institucional</span><input type="date" disabled value={preparation.appointment?.sessionDate || value.sessionDate || ""}/></label></section>
    </div>}
    <footer><button className="secondary-formation-button" disabled={starting} onClick={onClose}>Cancelar</button><div className="primary-action-state">{actionError ? <p id="real-session-start-error" className="primary-action-error" role="alert"><AlertTriangle size={15}/>{actionError}</p> : startRequirement ? <p id="real-session-start-requirement" className="primary-action-requirement">Para iniciar: {startRequirement}</p> : null}<button className="primary-formation-button" disabled={startDisabled} aria-describedby={actionError ? "real-session-start-error" : startRequirement ? "real-session-start-requirement" : undefined} title={startRequirement || undefined} onClick={onStart}>{starting ? <LoaderCircle className="spin" size={17}/> : <Play size={17}/>} {starting ? "Abriendo…" : "Iniciar sesión"}</button></div></footer>
  </section></ModalLayer>;
}

function RealSheetRow({ target, capture, paused, onOpen, onTrial, onFrequency }: {
  target: CollectionTarget & { programName: string };
  capture?: TargetCapture;
  paused: boolean;
  onOpen: () => void;
  onTrial: (code: TrialResponseCode) => void;
  onFrequency: (amount: number) => void;
}) {
  const status = targetStatus(target, capture);
  const last = activeObservations(capture || targetCapture(target)).at(-1)?.responseCode || target.lastPromptCode;
  const probe = target.state === "baseline" || target.state === "maintenance";
  const quickCodes: TrialResponseCode[] = probe ? ["I", "X"] : ["I", "G", "V", "X"];
  return <article className={`${status.minimumMet ? status.evaluation.status === "met" ? "sample-met" : "sample-ready" : ""}`}>
    <button className="real-sheet-summary" onClick={onOpen}>
      <div><span className={`target-state ${target.state}`}>{targetStateLabel(target.state)}</span><small>{target.programName}</small></div>
      <strong>{target.code} · {target.name}</strong><span>{responseLabel(last)}</span><em>{resultText(target, capture)}</em><ChevronRight size={17}/>
    </button>
    <div className="real-sheet-quick">
      {isDiscrete(target.measurement) && target.measurement !== "partial_interval" ? quickCodes.map((code) => <button type="button" disabled={paused} className={code === "I" ? "independent" : code === "X" ? "incorrect" : "prompt"} key={code} onClick={() => onTrial(code)}>{code}</button>)
        : target.measurement === "frequency" ? <><button type="button" disabled={paused} onClick={() => onFrequency(1)}>+1</button><button type="button" disabled={paused} onClick={() => onFrequency(5)}>+5</button><button type="button" onClick={onOpen}>Reloj</button></>
        : <button type="button" onClick={onOpen}>Abrir toma</button>}
    </div>
  </article>;
}

type AbcDraft = { antecedent: string; behavior: string; consequence: string; intensity: number; activity: string; programId: string; targetId: string; note: string };
type IntervalState = { targetId: string; endsAt: number } | null;

export default function RealSessionCollector({ initialDraft, onClosed, onDiscarded, notify }: { initialDraft: CollectionDraft; onClosed: () => void; onDiscarded: () => void; notify: (message: string) => void }) {
  const [draft, setDraft] = useState(initialDraft);
  const targets = useMemo(() => draft.preparation.programs.flatMap((program) => program.targets.map((target) => ({ ...target, programId: program.id, programName: program.name, programObjective: program.objective, programInstructions: program.instructions }))), [draft.preparation.programs]);
  const [focusedTargetId, setFocusedTargetId] = useState(targets[0]?.id || "");
  const [view, setView] = useState<"take" | "sheet">("take");
  const [notesOpen, setNotesOpen] = useState(false);
  const [teachingOpen, setTeachingOpen] = useState(false);
  const [probePromptsOpen, setProbePromptsOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [abcOpen, setAbcOpen] = useState(false);
  const [abcDraft, setAbcDraft] = useState<AbcDraft>({ antecedent: "", behavior: "", consequence: "", intensity: 3, activity: "", programId: targets[0]?.programId || "", targetId: targets[0]?.id || "", note: "" });
  const [intervalState, setIntervalState] = useState<IntervalState>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [saveError, setSaveError] = useState("");
  const [closing, setClosing] = useState(false);
  const [closeSubmitted, setCloseSubmitted] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [closeError, setCloseError] = useState("");
  const [therapistStrokes, setTherapistStrokes] = useState<SignaturePoint[][]>([]);
  const [coordinatorStrokes, setCoordinatorStrokes] = useState<SignaturePoint[][]>([]);
  const lastTap = useRef<{ targetId: string; at: number } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const finalizing = useRef(false);
  const finalSubmission = useRef<CollectionDraft | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const lastSavedDraft = useRef(initialDraft);
  const [saveQueue] = useState(() => createLatestSaveQueue<CollectionDraft>(async (next) => {
    const response = await clientRequest("/api/session-collection", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ draft: next }) });
    const body = await response.json() as { error?: string };
    if (!response.ok) throw new Error(body.error || "No se confirmó el guardado.");
    lastSavedDraft.current = next;
  }, (state, error) => {
    if (!alive.current) return;
    setSaveState(state === "saved" && lastSavedDraft.current !== draftRef.current ? "saving" : state);
    setSaveError(error?.message || "");
  }));

  const focusedIndex = Math.max(0, targets.findIndex((target) => target.id === focusedTargetId));
  const focused = targets[focusedIndex] || targets[0];
  const currentCapture = focused ? draft.captures[focused.id] || targetCapture(focused) : null;
  const sessionSeconds = Math.floor((draft.elapsedMs + (draft.runningSince ? Math.max(0, nowMs - Date.parse(draft.runningSince)) : 0)) / 1000);
  const paused = !draft.runningSince;
  const dataPresent = hasDraftData(draft);

  useEffect(() => { const timer = window.setInterval(() => setNowMs(Date.now()), 250); return () => window.clearInterval(timer); }, []);
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (hasDraftData(draft)) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", handler); return () => window.removeEventListener("beforeunload", handler); }, [draft]);
  useEffect(() => {
    const heartbeat = window.setInterval(() => {
      if (finalizing.current) return;
      const current = draftRef.current;
      if (!current.runningSince && !Object.values(current.captures).some((capture) => capture.timerStartedAt || capture.frequencyObservationStartedAt)) return;
      const next = { ...current, lastActiveAt: new Date().toISOString() };
      draftRef.current = next;
      setDraft(next);
      persist(next);
    }, 10000);
    return () => window.clearInterval(heartbeat);
  // The heartbeat intentionally uses the latest draft through a ref.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const pauseWhenHidden = () => {
      if (!document.hidden || finalizing.current) return;
      const current = draftRef.current;
      if (!current.runningSince && !Object.values(current.captures).some((capture) => capture.timerStartedAt || capture.frequencyObservationStartedAt)) return;
      const at = new Date().toISOString();
      const next = { ...stopCollectionClocks(current, at, () => crypto.randomUUID()), lastActiveAt: at };
      draftRef.current = next;
      setDraft(next);
      setIntervalState(null);
      persist(next);
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => document.removeEventListener("visibilitychange", pauseWhenHidden);
  // Pausing on background prevents off-screen time from entering clinical data.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (saveTimer.current) clearTimeout(saveTimer.current); }; }, []);

  function persist(next: CollectionDraft) {
    saveQueue.push(next);
  }

  function updateDraft(change: (current: CollectionDraft) => CollectionDraft, immediate = false) {
    if (finalizing.current) return;
    const next = { ...change(draftRef.current), lastActiveAt: new Date().toISOString() };
    draftRef.current = next;
    setDraft(next);
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (immediate) persist(next);
    else saveTimer.current = setTimeout(() => persist(next), 650);
  }

  function changeCapture(target: CollectionTarget, change: (capture: TargetCapture) => TargetCapture, immediate = true) {
    updateDraft((current) => { const base = current.captures[target.id] || targetCapture(target); return { ...current, captures: { ...current.captures, [target.id]: change(base) } }; }, immediate);
  }

  function selectTarget(id: string) {
    setFocusedTargetId(id); setView("take"); setTeachingOpen(false); setProbePromptsOpen(false); setIntervalState(null);
  }

  function recordTrialFor(target: CollectionTarget, code: TrialResponseCode) {
    if (paused) return;
    const tap = Date.now();
    if (isDuplicateTrialTap(lastTap.current, target.id, tap)) return;
    lastTap.current = { targetId: target.id, at: tap };
    const steps = target.sessionConfig.taskSteps.length ? target.sessionConfig.taskSteps : [target.specificObjective];
    const active = activeObservations(draftRef.current.captures[target.id] || targetCapture(target));
    const stepIndex = target.measurement === "task_analysis" ? active.length % steps.length : undefined;
    const probe = target.state === "baseline" || target.state === "maintenance";
    changeCapture(target, (capture) => ({ ...capture, opportunities: capture.opportunities + 1, observations: [...capture.observations, { id: crypto.randomUUID(), at: new Date().toISOString(), value: code === "I" ? 1 : 0, responseCode: code, ...(stepIndex !== undefined ? { taskStepIndex: stepIndex, taskStep: steps[stepIndex] } : {}), ...(probe ? { probe: true } : {}) }] }));
  }

  function recordTrial(code: TrialResponseCode) { if (focused) recordTrialFor(focused, code); }

  function undoLast() {
    if (!focused || !currentCapture) return;
    if (!activeObservations(currentCapture).length) return;
    const at = new Date().toISOString();
    changeCapture(focused, (capture) => voidLastObservation(capture, at, draftRef.current.preparation.professionalAccountId));
  }

  function adjustFrequencyFor(target: CollectionTarget, amount: number) {
    if (paused) return;
    const at = new Date().toISOString();
    changeCapture(target, (capture) => ({ ...capture, opportunities: Math.max(1, capture.opportunities), frequencyObservationStartedAt: capture.frequencyObservationStartedAt || at, observations: [...capture.observations, { id: crypto.randomUUID(), at, value: amount }] }));
  }

  function adjustFrequency(amount: number) { if (focused) adjustFrequencyFor(focused, amount); }

  function toggleFrequencyObservation() {
    if (!focused || paused) return;
    const at = new Date().toISOString(); const time = Date.parse(at);
    changeCapture(focused, (capture) => capture.frequencyObservationStartedAt
      ? { ...capture, frequencyObservationStartedAt: null, opportunities: Math.max(1, capture.opportunities), frequencyObservationElapsedMs: (capture.frequencyObservationElapsedMs || 0) + Math.max(0, time - Date.parse(capture.frequencyObservationStartedAt)) }
      : { ...capture, frequencyObservationStartedAt: at });
  }

  function toggleMeasurementTimer() {
    if (!focused || paused) return;
    const at = new Date().toISOString(); const time = Date.parse(at);
    changeCapture(focused, (capture) => capture.timerStartedAt
      ? { ...capture, timerStartedAt: null, opportunities: capture.opportunities + 1, observations: [...capture.observations, { id: crypto.randomUUID(), at, value: Math.max(0, Math.round((time - Date.parse(capture.timerStartedAt)) / 1000)) }] }
      : { ...capture, timerStartedAt: at });
  }

  function toggleSessionClock() {
    const at = new Date().toISOString();
    if (draftRef.current.runningSince) {
      setIntervalState(null);
      updateDraft((current) => stopCollectionClocks(current, at, () => crypto.randomUUID()), true);
    } else updateDraft((current) => ({ ...current, runningSince: at }), true);
  }

  function startInterval() {
    if (!focused || paused) return;
    setIntervalState({ targetId: focused.id, endsAt: Date.now() + focused.sessionConfig.intervalSeconds * 1000 });
  }

  function finishInterval(occurred: boolean) {
    if (!focused || !intervalState || intervalState.targetId !== focused.id) return;
    const expired = Date.now() >= intervalState.endsAt;
    const allowed = occurred ? !expired : expired;
    if (!allowed) return;
    changeCapture(focused, (capture) => ({ ...capture, opportunities: capture.opportunities + 1, observations: [...capture.observations, { id: crypto.randomUUID(), at: new Date().toISOString(), value: occurred ? 1 : 0, responseCode: occurred ? "I" : "X", intervalSeconds: focused.sessionConfig.intervalSeconds }] }));
    setIntervalState(null);
  }

  function openAbcCapture() {
    if (!focused) return;
    setAbcDraft({ antecedent: "", behavior: "", consequence: "", intensity: 3, activity: "", programId: focused.programId, targetId: focused.id, note: "" });
    setAbcOpen(true);
  }

  function saveAbc() {
    if (!abcDraft.antecedent.trim() || !abcDraft.behavior.trim() || !abcDraft.consequence.trim()) return notify("Completa antecedente, conducta y consecuencia.");
    const at = new Date().toISOString(); const local = collectionDateTime(at);
    const record: CollectionAbc = { id: crypto.randomUUID(), at, eventDate: local.date, eventTime: local.time, programId: abcDraft.programId || null, targetId: abcDraft.targetId || null, antecedent: abcDraft.antecedent.trim(), behavior: abcDraft.behavior.trim(), consequence: abcDraft.consequence.trim(), intensity: abcDraft.intensity, context: draft.context, activity: abcDraft.activity.trim(), note: abcDraft.note.trim() };
    updateDraft((current) => ({ ...current, abc: [...current.abc, record] }), true);
    setAbcOpen(false); notify("ABC agregado a esta sesión.");
  }

  async function discardEmpty() {
    if (hasDraftData(draftRef.current)) { setExitOpen(true); return; }
    if (finalizing.current) return;
    finalizing.current = true; setDiscarding(true);
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      await saveQueue.flush();
      const response = await clientRequest("/api/session-collection", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: draft.id }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || "No se pudo descartar la sesión vacía.");
      onDiscarded();
    } catch (error) { setSaveError(error instanceof Error ? error.message : "No se pudo descartar. Intenta nuevamente."); setSaveState("error"); }
    finally { finalizing.current = false; setDiscarding(false); }
  }

  function openClosing() {
    if (finalizing.current) return;
    setIntervalState(null);
    updateDraft((current) => stopCollectionClocks(current, new Date().toISOString(), () => crypto.randomUUID()), true);
    setCloseOpen(true);
  }

  async function closeSession() {
    if (closing || discarding) return;
    setCloseError("");
    if (!therapistStrokes.length) return setCloseError("La firma del terapeuta es obligatoria.");
    const current = draftRef.current;
    const coordinatorStarted = coordinatorStrokes.length > 0 || Boolean(current.closing?.coordinatorName.trim());
    if (coordinatorStarted && (!coordinatorStrokes.length || !current.closing?.coordinatorName.trim())) return setCloseError("Para agregar la firma opcional del coordinador, completa nombre y trazo.");
    const at = new Date().toISOString();
    const therapistSignature: SessionSignature = { version: 1, accountId: current.preparation.professionalAccountId, name: current.preparation.professionalName || "Profesional", signedAt: at, attested: true, strokes: therapistStrokes };
    const coordinatorSignature = coordinatorStrokes.length ? { version: 1 as const, accountId: "", name: current.closing?.coordinatorName.trim() || "Coordinador", signedAt: at, attested: true as const, strokes: coordinatorStrokes } : undefined;
    let finalDraft: CollectionDraft;
    try {
      finalDraft = finalSubmission.current || closeCollectionDraft({ ...current, signature: therapistSignature, closing: { ...current.closing!, coordinatorSignature } }, at, () => crypto.randomUUID());
    } catch (error) {
      const message = error instanceof CollectionError || error instanceof Error ? error.message : "Revisa los datos obligatorios.";
      return setCloseError(message);
    }
    setClosing(true);
    finalizing.current = true;
    try {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (!finalSubmission.current) { persist(current); await saveQueue.flush(); }
      // Keep one immutable payload if the network loses the closure receipt.
      finalSubmission.current = finalDraft;
      setCloseSubmitted(true);
      const response = await clientRequest("/api/session-collection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "close", payload: collectionPayload(finalDraft) }) });
      const body = await response.json() as { receipt?: { id: string }; error?: string };
      if (!response.ok && response.status < 500) { finalSubmission.current = null; setCloseSubmitted(false); }
      if (!response.ok || !body.receipt) throw new Error(body.error || "No se pudo cerrar la sesión.");
      draftRef.current = finalDraft;
      setDraft(finalDraft); onClosed();
    } catch (error) { setCloseError(`${error instanceof Error ? error.message : "No se confirmó el cierre."}${finalSubmission.current ? " Reintenta confirmar el cierre; no se duplicará la sesión." : " Conserva esta ventana abierta y reintenta."}`); }
    finally { setClosing(false); if (!finalSubmission.current) finalizing.current = false; }
  }

  if (!focused || !currentCapture) return null;
  const focusedStatus = targetStatus(focused, currentCapture);
  const activeTrials = activeObservations(currentCapture);
  const lastResponse = activeTrials.at(-1)?.responseCode;
  const probe = focused.state === "baseline" || focused.state === "maintenance";
  const steps = focused.sessionConfig.taskSteps.length ? focused.sessionConfig.taskSteps : [focused.specificObjective];
  const taskStepIndex = activeTrials.length % steps.length;
  const frequencyObservationMs = (currentCapture.frequencyObservationElapsedMs || 0) + (currentCapture.frequencyObservationStartedAt ? Math.max(0, nowMs - Date.parse(currentCapture.frequencyObservationStartedAt)) : 0);
  const measuredSeconds = activeTrials.reduce((sum, event) => sum + event.value, 0) + (currentCapture.timerStartedAt ? Math.max(0, Math.floor((nowMs - Date.parse(currentCapture.timerStartedAt)) / 1000)) : 0);
  const intervalExpired = Boolean(intervalState && nowMs >= intervalState.endsAt);
  const missingClosing = [
    ...draft.template.fields.filter(field => field.required && !draft.noteValues[field.id]?.trim()).map(field => `Completa: ${field.label}.`),
    ...(draft.closing?.guardianPresent && !draft.closing.guardianName.trim() ? ["Escribe el nombre del tutor."] : []),
    ...(draft.closing?.concernPresent && !draft.closing.concernNote.trim() ? ["Describe la preocupación médica o ambiental."] : []),
    ...(!therapistStrokes.length ? ["Traza la firma del terapeuta."] : []),
  ];
  const closeRequirement = sessionCloseRequirement(dataPresent, missingClosing);

  return <ModalLayer className="real-session-overlay" role="dialog" aria-modal="true" aria-label="Toma de sesión" onDismiss={() => dataPresent ? setExitOpen(true) : discardEmpty()} dismissDisabled={closing || closeSubmitted || discarding}>
    <header className="real-session-bar"><button className="real-exit" disabled={discarding} aria-label="Salir de la sesión" onClick={() => dataPresent ? setExitOpen(true) : discardEmpty()}><ArrowLeft size={19}/><span>Salir</span></button><div className="real-session-person"><strong>{draft.preparation.profile.fullName}</strong><small>{draft.context} · {targets.length} targets</small></div><button className={`real-session-clock ${paused ? "paused" : ""}`} onClick={toggleSessionClock}>{paused ? <Play size={17}/> : <Pause size={17}/>}<span><small>{paused ? "En pausa" : "Tiempo de sesión"}</small><strong>{formatElapsed(sessionSeconds)}</strong></span></button><div className="real-view-switch" role="group" aria-label="Vista de sesión"><button aria-pressed={view === "take"} className={view === "take" ? "active" : ""} onClick={() => setView("take")}><ClipboardList size={16}/>Tomar</button><button aria-pressed={view === "sheet"} className={view === "sheet" ? "active" : ""} onClick={() => setView("sheet")}><Grid3X3 size={16}/>Hoja</button></div><button className={`real-save-state ${saveState}`} type="button" disabled={saveState !== "error"} onClick={() => persist(draftRef.current)}><Save size={15}/><span>{saveState === "saving" ? "Guardando" : saveState === "error" ? "Reintentar guardado" : "Guardado"}</span></button>{draft.preparation.canRecordAbc && <button className="real-tool real-abc-button" aria-label="Registrar ABC" onClick={openAbcCapture}><ListTree size={17}/><span>ABC</span>{draft.abc.length > 0 && <em>{draft.abc.length}</em>}</button>}<button className={`real-tool real-note-button ${notesOpen ? "active" : ""}`} aria-label="Abrir nota de sesión" onClick={() => setNotesOpen(!notesOpen)}><NotebookPen size={17}/><span>Nota</span></button><button className="real-finish" onClick={openClosing}><CheckCircle2 size={17}/>Cerrar</button></header>

    {paused && <div className="real-paused-banner"><Pause size={17}/><strong>Sesión en pausa.</strong><span>Los botones de toma están desactivados hasta reanudar.</span><button onClick={toggleSessionClock}><Play size={15}/> Reanudar</button></div>}

    <div className="real-save-feedback" role="alert" hidden={saveState !== "error"}>{saveError || "No se confirmó el guardado."} Los datos siguen en esta ventana.<button onClick={() => persist(draftRef.current)}>Reintentar guardado</button></div><div className="real-session-main"><aside className="real-target-rail"><header><strong>Targets de hoy</strong><small>Última ayuda · muestra</small></header>{targets.map((target) => { const capture = draft.captures[target.id]; const status = targetStatus(target, capture); const currentLast = activeObservations(capture || targetCapture(target)).at(-1)?.responseCode || target.lastPromptCode; return <button className={`${target.id === focused.id ? "active" : ""} ${status.minimumMet ? status.evaluation.status === "met" ? "sample-met" : "sample-ready" : ""}`} key={target.id} onClick={() => selectTarget(target.id)}><span className={`target-state ${target.state}`}>{targetStateLabel(target.state)}</span><strong>{target.code} · {target.name}</strong><small>Ayuda: {responseLabel(currentLast)}</small><em>{resultText(target, capture)}</em>{status.minimumMet && <i>{status.evaluation.status === "met" ? "Muestra y criterio" : "Muestra completa"}</i>}</button>; })}</aside>

      {view === "sheet" ? <main className="real-sheet"><header><div><p className="section-kicker">Hoja de datos</p><h1>Todos los targets</h1></div><span>{targets.filter((target) => capturedResult(target, draft.captures[target.id]).sampled).length}/{targets.length} con datos</span></header><div>{targets.map((target) => <RealSheetRow key={target.id} target={target} capture={draft.captures[target.id]} paused={paused} onOpen={() => selectTarget(target.id)} onTrial={(code) => recordTrialFor(target, code)} onFrequency={(amount) => adjustFrequencyFor(target, amount)}/>)}</div></main> : <main className="real-take"><section className="real-target-heading"><div><span className={`target-state ${focused.state}`}>{targetStateLabel(focused.state)}</span><small>{focused.programName}</small><h1>{focused.code} · {focused.name}</h1><p><strong>Objetivo:</strong> {focused.specificObjective}</p><p className="real-sd"><strong>SD:</strong> {focused.sessionConfig.discriminativeStimulus || "No configurado"}</p></div><div className={`real-sample-badge ${focusedStatus.minimumMet ? focusedStatus.evaluation.status === "met" ? "met" : "ready" : ""}`}><small>Muestra mínima</small><strong>{focusedStatus.result.opportunities}/{focusedStatus.criterion?.minTrials || 0}</strong></div></section>
        <button className="real-teaching-toggle" aria-expanded={teachingOpen} onClick={() => setTeachingOpen(!teachingOpen)}><FileText size={16}/><span>Cómo enseñar</span><ChevronDown className={teachingOpen ? "open" : ""} size={16}/></button>{teachingOpen && <section className="real-teaching"><p>{focused.sessionConfig.teachingInstructions || focused.programInstructions || "No se han configurado instrucciones de enseñanza para este target."}</p></section>}
        <section className="real-capture-card"><header><div><small>Método</small><strong>{measurementLabel(focused.measurement)}{probe ? " · Sonda" : ""}</strong></div><span>{resultText(focused, currentCapture)}</span></header>
          {isDiscrete(focused.measurement) && focused.measurement !== "partial_interval" && <div className="real-discrete"><div className="real-trial-metrics"><div><strong>{focusedStatus.result.correct || 0}/{focusedStatus.result.opportunities}</strong><small>Independientes</small></div><div><strong>{focusedStatus.result.value ?? 0}%</strong><small>Resultado</small></div><div><strong>{responseLabel(lastResponse || focused.lastPromptCode)}</strong><small>Última ayuda</small></div></div>{focused.measurement === "task_analysis" && <div className="real-task-step"><span>{taskStepIndex + 1}/{steps.length}</span><div><small>Paso actual de la cadena</small><strong>{steps[taskStepIndex]}</strong></div></div>}<div className="real-trial-pad">{TRIAL_RESPONSES.filter((item) => !probe || item.code === "I" || item.code === "X" || probePromptsOpen).map((item) => <button disabled={paused} className={item.tone} key={item.code} onClick={() => recordTrial(item.code)}><b>{item.code}</b><span>{item.label}</span></button>)}</div>{probe && !probePromptsOpen && <button className="real-probe-prompts" onClick={() => setProbePromptsOpen(true)}>Registrar una ayuda que ocurrió</button>}{lastResponse && <div className={`real-trial-guidance ${lastResponse === "X" ? "error" : lastResponse === "I" ? "independent" : "prompt"}`}>{lastResponse === "I" ? "Siga sin ayuda." : lastResponse === "X" ? "Corrija con el mínimo de ayuda y vuelva a presentar el SD sin ayuda." : "En el siguiente ensayo intente independiente o un nivel menos de ayuda."}</div>}<div className="real-trial-strip"><div>{activeTrials.slice(-20).map((event, index) => <span className={event.responseCode === "I" ? "independent" : event.responseCode === "X" ? "incorrect" : "prompt"} key={event.id}><small>{Math.max(1, activeTrials.length - 19 + index)}</small><strong>{event.responseCode || (event.value ? "I" : "X")}</strong></span>)}</div><button disabled={!activeTrials.length} onClick={undoLast}><RotateCcw size={15}/> Deshacer</button></div></div>}
          {focused.measurement === "frequency" && <div className="real-frequency"><div className="real-frequency-number"><small>Ocurrencias</small><strong>{activeTrials.reduce((sum, event) => sum + event.value, 0)}</strong><span>{frequencyObservationMs > 0 ? `${Math.round((activeTrials.reduce((sum, event) => sum + event.value, 0) / frequencyObservationMs) * 600000) / 10} por minuto` : "Inicia la observación"}</span></div><div className="real-frequency-actions"><button disabled={paused} onClick={() => adjustFrequency(1)}>+1</button><button disabled={paused} onClick={() => adjustFrequency(5)}>+5</button></div><button disabled={paused} className={`real-observation-clock ${currentCapture.frequencyObservationStartedAt ? "running" : ""}`} onClick={toggleFrequencyObservation}>{currentCapture.frequencyObservationStartedAt ? <Pause size={18}/> : <Play size={18}/>}<span><small>Observación de esta conducta</small><strong>{formatElapsed(frequencyObservationMs / 1000)}</strong></span></button></div>}
          {(focused.measurement === "duration" || focused.measurement === "latency") && <div className="real-duration"><Timer size={27}/><small>Acumulado del día</small><strong>{formatElapsed(measuredSeconds)}</strong><button disabled={paused} className={currentCapture.timerStartedAt ? "running" : ""} onClick={toggleMeasurementTimer}>{currentCapture.timerStartedAt ? <><Pause size={19}/> Detener y guardar</> : <><Play size={19}/> Iniciar {focused.measurement === "duration" ? "duración" : "latencia"}</>}</button><span>{activeTrials.length} registro{activeTrials.length === 1 ? "" : "s"} guardado{activeTrials.length === 1 ? "" : "s"}</span></div>}
          {focused.measurement === "partial_interval" && <div className="real-interval"><div><small>Intervalo parcial</small><strong>{focused.sessionConfig.intervalSeconds} s</strong><span>{intervalState?.targetId === focused.id ? intervalExpired ? "Intervalo terminado" : `${Math.max(0, Math.ceil((intervalState.endsAt - nowMs) / 1000))} s restantes` : `${activeTrials.length} intervalos guardados`}</span></div>{!intervalState || intervalState.targetId !== focused.id ? <button disabled={paused} onClick={startInterval}><Play size={19}/> Iniciar intervalo</button> : intervalExpired ? <button className="did-not-occur" onClick={() => finishInterval(false)}><X size={19}/> No ocurrió</button> : <button className="occurred" onClick={() => finishInterval(true)}><Check size={19}/> Ocurrió</button>}<p>{intervalState?.targetId === focused.id && !intervalExpired ? "Durante el intervalo solo se puede marcar Ocurrió." : intervalExpired ? "Ahora puedes registrar No ocurrió." : "Inicia el reloj para observar."}</p></div>}
          <label className="real-target-note"><span>Nota breve del target <small>Opcional</small></span><input value={currentCapture.note} onChange={(event) => changeCapture(focused, (capture) => ({ ...capture, note: event.target.value }), false)} placeholder="Contexto, ayuda o variable observable"/></label>
        </section><nav className="real-target-navigation"><button disabled={focusedIndex === 0} onClick={() => selectTarget(targets[focusedIndex - 1]?.id)}><ChevronLeft size={17}/>Anterior</button><span>{focusedIndex + 1} de {targets.length}</span><button disabled={focusedIndex === targets.length - 1} onClick={() => selectTarget(targets[focusedIndex + 1]?.id)}>Siguiente<ChevronRight size={17}/></button></nav>
      </main>}

      {notesOpen && <ModalLayer className="real-session-modal real-note-layer" onDismiss={() => setNotesOpen(false)}><aside className="real-notes" role="dialog" aria-modal="true" aria-label="Nota de sesión"><header><div><small>Se guarda al cerrar</small><strong>{draft.template.name}</strong></div><button aria-label="Cerrar nota" onClick={() => setNotesOpen(false)}><X size={18}/></button></header><p>{draft.template.description}</p><div>{draft.template.fields.map((field) => <label key={field.id}><span>{field.label}{field.required && <em>Obligatorio</em>}</span>{field.guidance && <small>{field.guidance}</small>}<textarea value={draft.noteValues[field.id] || ""} onChange={(event) => updateDraft((current) => ({ ...current, noteValues: { ...current.noteValues, [field.id]: event.target.value } }), false)} placeholder="Información observable…"/></label>)}</div></aside></ModalLayer>}
    </div>

    {abcOpen && <ModalLayer onDismiss={() => setAbcOpen(false)} className="real-session-modal"><section className="real-abc-modal" role="dialog" aria-modal="true" aria-labelledby="real-abc-title"><header><div><p className="section-kicker">Sin salir de la sesión</p><h2 id="real-abc-title">Registrar ABC</h2></div><button onClick={() => setAbcOpen(false)} aria-label="Cerrar"><X size={19}/></button></header><div className="real-abc-grid"><label><span>Antecedente</span><textarea autoFocus value={abcDraft.antecedent} onChange={(event) => setAbcDraft({ ...abcDraft, antecedent: event.target.value })} placeholder="Qué ocurrió inmediatamente antes"/></label><label><span>Conducta</span><textarea value={abcDraft.behavior} onChange={(event) => setAbcDraft({ ...abcDraft, behavior: event.target.value })} placeholder="Qué hizo exactamente el niño"/></label><label><span>Consecuencia</span><textarea value={abcDraft.consequence} onChange={(event) => setAbcDraft({ ...abcDraft, consequence: event.target.value })} placeholder="Qué ocurrió inmediatamente después"/></label><label><span>Intensidad</span><select value={abcDraft.intensity} onChange={(event) => setAbcDraft({ ...abcDraft, intensity: Number(event.target.value) })}>{[1,2,3,4,5].map((value) => <option value={value} key={value}>{value}{value === 1 ? " · mínima" : value === 5 ? " · máxima" : ""}</option>)}</select></label><label><span>Actividad</span><input value={abcDraft.activity} onChange={(event) => setAbcDraft({ ...abcDraft, activity: event.target.value })} placeholder="Actividad en curso"/></label><label><span>Target relacionado</span><select value={abcDraft.targetId} onChange={(event) => { const target = targets.find((item) => item.id === event.target.value); setAbcDraft({ ...abcDraft, targetId: event.target.value, programId: target?.programId || "" }); }}><option value="">Sin target</option>{targets.map((target) => <option value={target.id} key={target.id}>{target.code} · {target.name}</option>)}</select></label><label className="wide"><span>Observación adicional</span><textarea value={abcDraft.note} onChange={(event) => setAbcDraft({ ...abcDraft, note: event.target.value })}/></label></div><footer><button className="secondary-formation-button" onClick={() => setAbcOpen(false)}>Cancelar</button><button className="primary-formation-button" onClick={saveAbc}><Save size={16}/> Agregar a la sesión</button></footer></section></ModalLayer>}

    {exitOpen && <ModalLayer onDismiss={() => setExitOpen(false)} className="real-session-modal"><section className="real-exit-modal" role="alertdialog" aria-modal="true"><ShieldAlert size={27}/><h2>Esta sesión ya tiene datos</h2><p>No se puede descartar. Conserva esta ventana abierta; para salir debes cerrar y firmar la sesión.</p><div><button className="secondary-formation-button" onClick={() => setExitOpen(false)}>Continuar tomando</button><button className="primary-formation-button" onClick={() => { setExitOpen(false); openClosing(); }}>Ir al cierre</button></div></section></ModalLayer>}

    {closeOpen && <ModalLayer onDismiss={() => setCloseOpen(false)} dismissDisabled={closing || closeSubmitted} className="real-session-modal close"><section className="real-close-modal" role="dialog" aria-modal="true" aria-labelledby="real-close-title"><header><div><p className="section-kicker">Etapa final</p><h2 id="real-close-title">Cerrar sesión</h2><span>{formatElapsed(sessionSeconds)} · {draft.preparation.profile.fullName}</span></div><button aria-label="Volver a la toma" disabled={closing || closeSubmitted} onClick={() => setCloseOpen(false)}><X size={20}/></button></header><div className="real-close-content" inert={closing || closeSubmitted}><section className="real-close-summary"><h3>Resumen por target</h3><div>{targets.map((target) => { const status = targetStatus(target, draft.captures[target.id]); const label = !status.result.sampled ? "Sin dato" : status.evaluation.status === "met" ? "Cumple" : status.evaluation.status === "not_met" ? "No cumple" : status.evaluation.status === "insufficient_sample" ? "Muestra corta" : "Sin dato"; return <article key={target.id}><div><strong>{target.code} · {target.name}</strong><small>{resultText(target, draft.captures[target.id])}</small></div><span className={status.evaluation.status}>{label}</span></article>; })}</div></section><section className="real-close-note"><h3>Nota de sesión</h3>{draft.template.fields.map((field) => <label key={field.id}><span>{field.label}{field.required && <em>Obligatorio</em>}</span><textarea value={draft.noteValues[field.id] || ""} onChange={(event) => updateDraft((current) => ({ ...current, noteValues: { ...current.noteValues, [field.id]: event.target.value } }), false)}/></label>)}</section><section className="real-close-fields"><h3>Actividades e incidencias</h3><label><span>Actividades realizadas</span><textarea value={draft.closing?.activities || ""} onChange={(event) => updateDraft((current) => ({ ...current, closing: { ...current.closing!, activities: event.target.value } }), false)}/></label><label><span>Incidentes</span><textarea value={draft.closing?.incidents || ""} onChange={(event) => updateDraft((current) => ({ ...current, closing: { ...current.closing!, incidents: event.target.value } }), false)} placeholder="Escribe los incidentes o indica que no hubo."/></label><fieldset><legend>¿Estuvo el tutor?</legend><label><input type="radio" name="guardian-present" checked={!draft.closing?.guardianPresent} onChange={() => updateDraft((current) => ({ ...current, closing: { ...current.closing!, guardianPresent: false, guardianName: "" } }), false)}/> No</label><label><input type="radio" name="guardian-present" checked={Boolean(draft.closing?.guardianPresent)} onChange={() => updateDraft((current) => ({ ...current, closing: { ...current.closing!, guardianPresent: true } }), false)}/> Sí</label>{draft.closing?.guardianPresent && <input value={draft.closing.guardianName} onChange={(event) => updateDraft((current) => ({ ...current, closing: { ...current.closing!, guardianName: event.target.value } }), false)} aria-label="Nombre del tutor" required placeholder="Nombre del tutor"/>}</fieldset><fieldset><legend>¿Preocupación médica o ambiental?</legend><label><input type="radio" name="concern-present" checked={!draft.closing?.concernPresent} onChange={() => updateDraft((current) => ({ ...current, closing: { ...current.closing!, concernPresent: false, concernNote: "" } }), false)}/> No</label><label><input type="radio" name="concern-present" checked={Boolean(draft.closing?.concernPresent)} onChange={() => updateDraft((current) => ({ ...current, closing: { ...current.closing!, concernPresent: true } }), false)}/> Sí</label>{draft.closing?.concernPresent && <textarea value={draft.closing.concernNote} onChange={(event) => updateDraft((current) => ({ ...current, closing: { ...current.closing!, concernNote: event.target.value } }), false)} aria-label="Preocupación médica o ambiental" required placeholder="Describe obligatoriamente la preocupación"/>}</fieldset></section><section className="real-signatures"><h3>Firmas</h3><div><div className="signature-field"><span>Terapeuta · obligatorio</span><strong>{draft.preparation.professionalName || "Profesional de la sesión"}</strong><SignaturePad strokes={therapistStrokes} onChange={setTherapistStrokes} label="Firma del terapeuta"/></div><div className="signature-field"><span>Coordinador · opcional</span><input value={draft.closing?.coordinatorName || ""} onChange={(event) => updateDraft((current) => ({ ...current, closing: { ...current.closing!, coordinatorName: event.target.value } }), false)} aria-label="Nombre del coordinador" placeholder="Nombre del coordinador"/><SignaturePad strokes={coordinatorStrokes} onChange={setCoordinatorStrokes} label="Firma opcional del coordinador"/></div></div></section></div>{closeError && <div className="real-close-error" role="alert"><AlertTriangle size={17}/>{closeError}</div>}{missingClosing.length > 0 && <details className="real-close-checklist"><summary>{missingClosing.length === 1 ? "Falta 1 requisito" : `Faltan ${missingClosing.length} requisitos`} para cerrar. Ver detalle</summary><ul>{missingClosing.map(message => <li key={message}>{message}</li>)}</ul></details>}<footer>{!dataPresent ? <button className="danger-button" disabled={discarding || closing || closeSubmitted} onClick={discardEmpty}><Trash2 size={16}/> Descartar sesión vacía</button> : <span><Save size={15}/> El borrador clínico no puede descartarse.</span>}<div className="real-close-actions"><button className="secondary-formation-button" disabled={closing || closeSubmitted} onClick={() => setCloseOpen(false)}>Volver a la toma</button><div className="primary-action-state">{closeRequirement && !closing && <p id="real-close-requirement" className="primary-action-requirement">Para firmar y cerrar: {closeRequirement}</p>}<button className="primary-formation-button" disabled={closing || Boolean(closeRequirement)} aria-describedby={closeRequirement ? "real-close-requirement" : undefined} title={closeRequirement || undefined} onClick={closeSession}>{closing ? <LoaderCircle className="spin" size={17}/> : <CheckCircle2 size={17}/>} {closing ? "Cerrando…" : closeSubmitted ? "Reintentar confirmar cierre" : "Firmar y cerrar"}</button></div></div></footer></section></ModalLayer>}
  </ModalLayer>;
}

function SignaturePad({ strokes, onChange, label }: { strokes: SignaturePoint[][]; onChange: Dispatch<SetStateAction<SignaturePoint[][]>>; label: string }) {
  const drawing = useRef(false);
  function point(event: ReactPointerEvent<SVGSVGElement>): SignaturePoint {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)) };
  }
  function start(event: ReactPointerEvent<SVGSVGElement>) { event.preventDefault(); drawing.current = true; event.currentTarget.setPointerCapture(event.pointerId); const next = point(event); onChange((current) => [...current, [next]]); }
  function move(event: ReactPointerEvent<SVGSVGElement>) { if (!drawing.current) return; const next = point(event); onChange((current) => current.map((stroke, index) => index === current.length - 1 ? [...stroke, next] : stroke)); }
  function stop() { drawing.current = false; }
  return <div className="signature-pad"><svg role="img" aria-label={label} viewBox="0 0 1 1" preserveAspectRatio="none" onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop}>{strokes.map((stroke, index) => <polyline key={index} points={stroke.map((item) => `${item.x},${item.y}`).join(" ")} fill="none" stroke="currentColor" strokeWidth="2.2" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round"/>)}</svg><div><small>{strokes.length ? "Firma trazada" : "Firma dentro del recuadro"}</small><button type="button" aria-label={`Limpiar ${label.toLowerCase()}`} disabled={!strokes.length} onClick={() => onChange([])}><RotateCcw size={13}/> Limpiar</button></div></div>;
}
