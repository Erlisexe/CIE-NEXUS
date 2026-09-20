"use client";

import { clientRequest } from "../../lib/client-request";
import { matchesClinicalFilter } from "../../lib/clinical-filter";

import ModalLayer from "./modal-layer";

import {
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  ClipboardCheck,
  Clock3,
  Edit3,
  FileText,
  Layers3,
  ListTree,
  LineChart,
  LoaderCircle,
  NotebookPen,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { PersonnelProfile } from "./personnel-profile-manager";
import type { CalendarAppointment } from "./calendar-manager";
import RealSessionCollector, { RealSessionSetup, type SessionSetupValue } from "./real-session-collector";
import type { CollectionDraft, CollectionPreparation } from "../../lib/mobile-collection";
import { DEFAULT_SESSION_NOTE_TEMPLATE, type SessionNoteField } from "../../lib/session-note-templates";
import { summarizeClosedSessions, programsForClinicalSession } from "../../lib/clinical-session-runs";
import { targetStateLabel } from "../../lib/clinical-mastery";

const STATE_ORDER = ["baseline", "acquisition", "generalization", "maintenance", "closed"] as const;
type TargetState = typeof STATE_ORDER[number];
type CriterionStage = Exclude<TargetState, "closed">;
type Measurement = "percentage" | "frequency" | "duration" | "latency" | "occurrence" | "discrete_trials" | "partial_interval" | "task_analysis";
type ProgramGraphType = "line" | "bar" | "cumulative";
type ProgramGraphDesign = "simple" | "AB" | "ABA" | "ABAB" | "BAB" | "multiple-baseline" | "multielement" | "changing-criterion" | "custom";

type ProgramGraphConfig = {
  graphType: ProgramGraphType;
  designType: ProgramGraphDesign;
  clinicalMetric: "percentage" | "count" | "opportunities" | "rate" | "mastered";
  clinicalGrouping: "session" | "day" | "week" | "month";
  primaryTargetId: string | null;
  primaryTargetIndex?: number;
  showPoints: boolean;
  showLegend: boolean;
};

type Criterion = {
  metric: "percentage_correct" | "correct_count" | "value";
  operator: "gte" | "lte";
  threshold: number;
  requiredSessions: number;
  minTrials: number;
  consecutive: boolean;
  distinctContexts: number;
  insufficientSampleBreaksStreak: boolean;
};

type TargetDefinition = {
  id?: string;
  code: string;
  name: string;
  specificObjective: string;
  measurement: Measurement;
  unitLabel: string;
  state: TargetState;
  masteryAchieved?: boolean;
  masteredAt?: string | null;
  masteryMethod?: "baseline" | "acquisition" | null;
  criteria: Record<CriterionStage, Criterion>;
  sessionConfig: {
    discriminativeStimulus: string;
    teachingInstructions: string;
    taskSteps: string[];
    intervalSeconds: 10 | 30 | 60;
    maintenanceProbeEveryDays: number;
  };
};

type InterventionProgram = {
  id: string;
  profileId: string | null;
  linkedCycleId: string | null;
  name: string;
  participantName: string;
  site: string;
  objective: string;
  instructions: string;
  graphConfig: ProgramGraphConfig;
  status: string;
  targets: TargetDefinition[];
  updatedAt: string;
};

type Transition = {
  targetId: string;
  code: string;
  targetName: string;
  from: TargetState;
  to: TargetState;
  reason: string;
};

type InterventionSession = {
  id: string;
  clinicalSessionRunId?: string | null;
  programId: string;
  sessionDate: string;
  context: string;
  notes: string;
  status: string;
  results: Array<{ targetId: string; sampled: boolean; value: number | null; correct: number | null; opportunities: number; trials: Array<0 | 1>; note: string; stateAtSession: TargetState; criterionStatus: "met" | "not_met" | "insufficient_sample" | "not_evaluated"; criterionReason: string }>;
  transitions: Transition[];
  closedAt: string | null;
};

type CycleOption = {
  id: string;
  profileId: string | null;
  participantName: string;
  site: string;
  programContext: string;
  archivedAt: string | null;
};

type ProgramForm = Omit<InterventionProgram, "id" | "status" | "updatedAt"> & { id?: string };

type SessionResultDraft = {
  sampled: boolean;
  value: string;
  correct: string;
  opportunities: string;
  trials: Array<0 | 1>;
  note: string;
};

type ActiveSession = {
  profileId: string;
  programIds: string[];
  sessionDate: string;
  context: string;
  noteTemplateId: string;
  noteValues: Record<string, string>;
  startedAt: string;
  results: Record<string, SessionResultDraft>;
};

type SessionNoteTemplate = {
  id: string;
  name: string;
  description: string;
  fields: SessionNoteField[];
  builtIn: boolean;
  status: string;
};

type SessionNoteTemplateDraft = Pick<SessionNoteTemplate, "name" | "description" | "fields"> & { id?: string };

function blankSessionNoteTemplate(): SessionNoteTemplateDraft {
  return { name: "", description: "", fields: [{ id: crypto.randomUUID(), label: "", guidance: "", required: true }] };
}

function stateLabel(state: TargetState) {
  return targetStateLabel(state);
}

function stageDestination(stage: CriterionStage) {
  return stage === "baseline" ? "Masterizado o Adquisición" : stage === "acquisition" ? "Masterizado" : stage === "generalization" ? "Generalizado" : "Cerrado";
}

function measurementLabel(measurement: Measurement) {
  return {
    percentage: "Porcentaje / ensayos",
    frequency: "Frecuencia",
    duration: "Duración",
    latency: "Latencia",
    occurrence: "Ensayos discretos",
    discrete_trials: "Ensayos discretos con ayudas",
    partial_interval: "Intervalo parcial",
    task_analysis: "Análisis de tarea",
  }[measurement];
}

function unitFor(measurement: Measurement) {
  return ["percentage", "occurrence", "discrete_trials", "partial_interval", "task_analysis"].includes(measurement) ? "%" : measurement === "frequency" ? "ocurrencias" : "segundos";
}

function defaultCriterion(stage: CriterionStage, measurement: Measurement = "percentage"): Criterion {
  return {
    metric: ["percentage", "occurrence", "discrete_trials", "partial_interval", "task_analysis"].includes(measurement) ? "percentage_correct" : "value",
    operator: "gte",
    threshold: stage === "baseline" ? 90 : 80,
    requiredSessions: stage === "baseline" ? 1 : stage === "generalization" || stage === "maintenance" ? 2 : 3,
    minTrials: ["percentage", "occurrence", "discrete_trials", "partial_interval", "task_analysis"].includes(measurement) ? 3 : 1,
    consecutive: true,
    distinctContexts: stage === "generalization" ? 2 : 1,
    insufficientSampleBreaksStreak: false,
  };
}

function blankTarget(index: number): TargetDefinition {
  return {
    code: `T${String(index + 1).padStart(2, "0")}`,
    name: "",
    specificObjective: "",
    measurement: "percentage",
    unitLabel: "%",
    state: "baseline",
    criteria: {
      baseline: defaultCriterion("baseline"),
      acquisition: defaultCriterion("acquisition"),
      generalization: defaultCriterion("generalization"),
      maintenance: defaultCriterion("maintenance"),
    },
    sessionConfig: { discriminativeStimulus: "", teachingInstructions: "", taskSteps: [], intervalSeconds: 30, maintenanceProbeEveryDays: 7 },
  };
}

function blankProgram(profile?: PersonnelProfile): ProgramForm {
  return {
    profileId: profile?.id || null,
    linkedCycleId: null,
    name: "",
    participantName: profile?.fullName || "",
    site: profile?.site || "León",
    objective: "",
    instructions: "",
    graphConfig: { graphType: "line", designType: "AB", clinicalMetric: "percentage", clinicalGrouping: "session", primaryTargetId: null, primaryTargetIndex: 0, showPoints: true, showLegend: true },
    targets: [blankTarget(0)],
  };
}

function criterionText(target: TargetDefinition) {
  if (target.state === "closed") return "Target cerrado; se conserva su historial de datos.";
  const criterion = target.criteria[target.state];
  const comparison = criterion.operator === "lte" ? "≤" : "≥";
  const contexts = criterion.distinctContexts > 1 ? ` · ${criterion.distinctContexts} contextos` : "";
  return `${comparison} ${criterion.threshold} ${criterion.metric === "percentage_correct" ? "% correctas" : target.unitLabel} · ${criterion.requiredSessions} sesión(es)${criterion.consecutive ? " consecutivas" : ""} · mín. ${criterion.minTrials} oportunidades${contexts}`;
}

function formatElapsed(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "CN";
}

export default function InterventionSessionManager({
  mode,
  cycles,
  profiles,
  selectedProfileId,
  selectedSite,
  onSelectProfile,
  onProfilesRefresh,
  notify,
  canManagePrograms = true,
  canRecordSessions = true,
  canManageSessions = true,
  initialAppointment = null,
  onAppointmentConsumed,
  allowAdHocSessions = true,
  historyOnly = false,
  canManageSessionNoteTemplates = false,
  onOpenProgramGraph,
  onRegisterABC,
}: {
  mode: "programs" | "sessions";
  cycles: CycleOption[];
  profiles: PersonnelProfile[];
  selectedProfileId: string;
  selectedSite: string;
  onSelectProfile: (id: string) => void;
  onProfilesRefresh: () => void;
  notify: (message: string) => void;
  canManagePrograms?: boolean;
  canRecordSessions?: boolean;
  canManageSessions?: boolean;
  initialAppointment?: CalendarAppointment | null;
  onAppointmentConsumed?: () => void;
  allowAdHocSessions?: boolean;
  historyOnly?: boolean;
  canManageSessionNoteTemplates?: boolean;
  onOpenProgramGraph?: (programId: string) => void;
  onRegisterABC?: (context: { profileId: string; profileName: string; programId: string; appointmentId: string | null }) => void;
}) {
  const [programs, setPrograms] = useState<InterventionProgram[]>([]);
  const [sessions, setSessions] = useState<InterventionSession[]>([]);
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [noteTemplates, setNoteTemplates] = useState<SessionNoteTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [programModal, setProgramModal] = useState(false);
  const [form, setForm] = useState<ProgramForm>(blankProgram());
  const [setupOpen, setSetupOpen] = useState(false);
  const [setup, setSetup] = useState<{ profileId: string; sessionDate: string; context: string; noteTemplateId: string }>({ profileId: "", sessionDate: new Date().toISOString().slice(0, 10), context: "", noteTemplateId: DEFAULT_SESSION_NOTE_TEMPLATE.id });
  const [realSetupOpen, setRealSetupOpen] = useState(false);
  const [realSetup, setRealSetup] = useState<SessionSetupValue>({ profileId: "", sessionDate: new Date().toISOString().slice(0, 10), contextCategory: "", contextOther: "", noteTemplateId: DEFAULT_SESSION_NOTE_TEMPLATE.id, selectedTargetIds: [] });
  const [realPreparation, setRealPreparation] = useState<CollectionPreparation | null>(null);
  const [realPreparationLoading, setRealPreparationLoading] = useState(false);
  const [realPreparationError, setRealPreparationError] = useState("");
  const [preparationRevision, setPreparationRevision] = useState(0);
  const [realStarting, setRealStarting] = useState(false);
  const [realSessionDraft, setRealSessionDraft] = useState<CollectionDraft | null>(null);
  const [reloadRevision, setReloadRevision] = useState(0);
  const [linkedAppointmentId, setLinkedAppointmentId] = useState<string | null>(null);
  const [activeSession, setActiveSession] = useState<ActiveSession | null>(null);
  const [lastTransitions, setLastTransitions] = useState<Transition[]>([]);
  const [expandedProgramId, setExpandedProgramId] = useState<string | null>(null);
  const [editingSession, setEditingSession] = useState<InterventionSession | null>(null);
  const [deleteProgramTarget, setDeleteProgramTarget] = useState<InterventionProgram | null>(null);
  const [deleteSessionTarget, setDeleteSessionTarget] = useState<InterventionSession | null>(null);
  const [deleteText, setDeleteText] = useState("");
  const [focusedTargetId, setFocusedTargetId] = useState<string | null>(null);
  const [focusedProgramId, setFocusedProgramId] = useState<string | null>(null);
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const [runningTimerTargetId, setRunningTimerTargetId] = useState<string | null>(null);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [sessionNotesOpen, setSessionNotesOpen] = useState(false);
  const [finishReviewOpen, setFinishReviewOpen] = useState(false);
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [templateDraft, setTemplateDraft] = useState<SessionNoteTemplateDraft | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    // A new server scope must hide the old results until its request completes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadError(""); setLoading(true);
    Promise.all([
      clientRequest(mode === "sessions" && historyOnly && selectedProfileId !== "all"
        ? `/api/intervention-programs?profileId=${encodeURIComponent(selectedProfileId)}`
        : mode === "sessions" ? "/api/intervention-programs?scope=mine" : "/api/intervention-programs", { signal: controller.signal }),
      mode === "sessions" && !historyOnly ? clientRequest(`/api/calendar?from=${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Managua" }).format(new Date())}&mine=1`, { signal: controller.signal }) : Promise.resolve(null),
      mode === "sessions" && !historyOnly ? clientRequest("/api/session-note-templates", { cache: "no-store", signal: controller.signal }) : Promise.resolve(null),
    ])
      .then(async ([response, calendarResponse, templateResponse]) => {
        const data = await response.json() as { programs?: InterventionProgram[]; sessions?: InterventionSession[]; error?: string };
        if (!response.ok) throw new Error(data.error || "No se pudieron cargar los programas.");
        const calendarData = calendarResponse ? await calendarResponse.json() as { appointments?: CalendarAppointment[]; error?: string } : null;
        if (calendarResponse && !calendarResponse.ok) throw new Error(calendarData?.error || "No se pudo cargar la agenda.");
        const templateData = templateResponse ? await templateResponse.json() as { templates?: SessionNoteTemplate[]; error?: string } : null;
        if (templateResponse && !templateResponse.ok) throw new Error(templateData?.error || "No se pudieron cargar las plantillas de notas.");
        if (!cancelled) {
          const loadedPrograms = data.programs || [];
          setPrograms(loadedPrograms);
          setSessions(data.sessions || []);
          setAppointments(calendarData?.appointments || []);
          setNoteTemplates(templateData?.templates || []);
          if (mode === "sessions" && initialAppointment) {
            setRealSetup({ profileId: initialAppointment.profileId, sessionDate: initialAppointment.sessionDate, contextCategory: "", contextOther: "", noteTemplateId: templateData?.templates?.[0]?.id || DEFAULT_SESSION_NOTE_TEMPLATE.id, selectedTargetIds: [] });
            setLinkedAppointmentId(initialAppointment.id);
            setRealPreparationLoading(true);
            setRealSetupOpen(true);
            onAppointmentConsumed?.();
          }
        }
      })
      .catch((error: Error) => { if (!cancelled) { setLoadError(error.message); notify(error.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  // The initial load is intentionally tied to the mounted module, not to toast identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, historyOnly, selectedProfileId, initialAppointment, onAppointmentConsumed, reloadRevision]);

  useEffect(() => {
    if (!realSetupOpen || !realSetup.profileId) {
      return;
    }
    const controller = new AbortController();
    // Loading state belongs to this abortable request, including explicit retries.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRealPreparationLoading(true); setRealPreparationError("");
    const query = new URLSearchParams({ profileId: realSetup.profileId });
    if (linkedAppointmentId) query.set("appointmentId", linkedAppointmentId);
    clientRequest(`/api/session-collection?${query.toString()}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { preparation?: CollectionPreparation; draft?: CollectionDraft | null; error?: string };
        if (controller.signal.aborted) return;
        if (!response.ok || !body.preparation) throw new Error(body.error || "No se pudo preparar la toma de sesión.");
        if (body.draft) {
          setRealSessionDraft(body.draft);
          setRealSetupOpen(false);
          notify("Se reanudó el borrador guardado de esta sesión.");
          return;
        }
        setRealPreparation(body.preparation);
        setRealSetup((current) => ({
          ...current,
          sessionDate: body.preparation?.appointment?.sessionDate || current.sessionDate,
          noteTemplateId: body.preparation?.templates.some((template) => template.id === current.noteTemplateId)
            ? current.noteTemplateId
            : body.preparation?.templates[0]?.id || DEFAULT_SESSION_NOTE_TEMPLATE.id,
          selectedTargetIds: current.selectedTargetIds.filter((id) => body.preparation?.programs.some((program) => program.targets.some((target) => target.id === id))),
        }));
      })
      .catch((error: Error) => {
        if (controller.signal.aborted) return;
        setRealPreparationError(error.message);
      })
      .finally(() => { if (!controller.signal.aborted) setRealPreparationLoading(false); });
    return () => controller.abort();
  // Toast identity must not restart a clinical preparation request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [realSetupOpen, realSetup.profileId, linkedAppointmentId, preparationRevision]);

  const sessionIsActive = Boolean(activeSession);

  useEffect(() => {
    if (!sessionIsActive) return;
    const interval = window.setInterval(() => setSessionElapsed((current) => current + 1), 1000);
    return () => window.clearInterval(interval);
  }, [sessionIsActive]);

  useEffect(() => {
    if (!runningTimerTargetId) return;
    const targetId = runningTimerTargetId;
    const interval = window.setInterval(() => {
      setActiveSession((current) => {
        const draft = current?.results[targetId];
        if (!current || !draft) return current;
        const nextValue = Math.max(0, Math.round(Number(draft.value || 0))) + 1;
        return { ...current, results: { ...current.results, [targetId]: { ...draft, sampled: true, value: String(nextValue), opportunities: "1" } } };
      });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [runningTimerTargetId]);

  const activeProfiles = profiles.filter((profile) => profile.status === "active" && (selectedSite === "Todas" || profile.site === selectedSite));
  const scopedAppointments = appointments.filter((appointment) => matchesClinicalFilter({ ...appointment, site: profiles.find((profile) => profile.id === appointment.profileId)?.site || appointment.site }, { site: selectedSite, profileId: selectedProfileId }));
  const institutionalToday = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Managua" }).format(new Date());
  const activeProfileIds = new Set(profiles.filter((profile) => profile.status === "active").map((profile) => profile.id));
  const activePrograms = programs.filter((program) => program.status === "active" && Boolean(program.profileId && activeProfileIds.has(program.profileId)) && matchesClinicalFilter({ ...program, site: profiles.find((profile) => profile.id === program.profileId)?.site || program.site }, { site: selectedSite, profileId: selectedProfileId }));
  const sessionProfileOptions = activeProfiles.filter((profile) => programs.some((program) => program.profileId === profile.id && program.status === "active" && program.targets.some((target) => target.state !== "closed"))).map((profile) => ({ id: profile.id, label: `${profile.fullName} · ${profile.site}` }));
  const allTargets = activePrograms.flatMap((program) => program.targets);
  const visibleProgramIds = new Set(programs.filter((program) => profiles.some((profile) => profile.id === program.profileId) && matchesClinicalFilter({ ...program, site: profiles.find((profile) => profile.id === program.profileId)?.site || program.site }, { site: selectedSite, profileId: selectedProfileId })).map((program) => program.id));
  const visibleSessions = sessions.filter((session) => session.status === "closed" && visibleProgramIds.has(session.programId));
  const sessionSummary = summarizeClosedSessions(visibleSessions);
  const visibleSessionGroups = sessionSummary.groups;
  const sessionPrograms = activeSession ? programs.filter((program) => activeSession.programIds.includes(program.id)) : [];
  const sessionProgram = activeSession ? sessionPrograms.find((program) => program.id === focusedProgramId) || sessionPrograms[0] || null : null;
  const setupProfile = profiles.find((profile) => profile.id === setup.profileId) || null;
  const setupPrograms = programsForClinicalSession(programs, setup.profileId);
  const selectedNoteTemplate = noteTemplates.find((template) => template.id === setup.noteTemplateId) || noteTemplates[0] || null;

  function openNewProgram() {
    const profile = activeProfiles.find((item) => item.id === selectedProfileId) || activeProfiles[0];
    if (!profile) {
      notify("Agrega primero un niño.");
      return;
    }
    setForm(blankProgram(profile));
    setProgramModal(true);
  }

  function openEditProgram(program: InterventionProgram) {
    setForm(JSON.parse(JSON.stringify(program)) as ProgramForm);
    setProgramModal(true);
  }

  function updateTarget(index: number, patch: Partial<TargetDefinition>) {
    setForm((current) => ({ ...current, targets: current.targets.map((target, i) => i === index ? { ...target, ...patch } : target) }));
  }

  function updateCriterion(index: number, stage: CriterionStage, patch: Partial<Criterion>) {
    setForm((current) => ({
      ...current,
      targets: current.targets.map((target, i) => i === index ? {
        ...target,
        criteria: { ...target.criteria, [stage]: { ...target.criteria[stage], ...patch } },
      } : target),
    }));
  }

  function addTarget() {
    setForm((current) => ({ ...current, targets: [...current.targets, blankTarget(current.targets.length)] }));
  }

  function removeTarget(index: number) {
    if (form.targets.length === 1) return;
    setForm((current) => ({ ...current, targets: current.targets.filter((_, i) => i !== index) }));
  }

  async function saveProgram() {
    if (!form.profileId || !form.name.trim() || !form.objective.trim() || form.targets.some((target) => !target.name.trim() || !target.specificObjective.trim())) {
      notify("Completa el objetivo general y el nombre y objetivo específico de cada target.");
      return;
    }
    setSaving(true);
    try {
      const submit = (confirmMasteryRecalculation = false) => clientRequest("/api/intervention-programs", {
        method: form.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, action: form.id ? "update_program" : "create_program", confirmMasteryRecalculation, recalculationReason: confirmMasteryRecalculation ? "Cambio de criterio confirmado por usuario autorizado." : "" }),
      });
      let response = await submit();
      let data = await response.json() as { program?: InterventionProgram; error?: string; requiresMasteryRecalculation?: boolean };
      if (response.status === 409 && data.requiresMasteryRecalculation) {
        const confirmed = window.confirm(`${data.error}\n\nSi continúas, se conservará una auditoría y se recalculará la gráfica acumulativa.`);
        if (!confirmed) return;
        response = await submit(true);
        data = await response.json() as typeof data;
      }
      if (!response.ok || !data.program) throw new Error(data.error || "No se pudo guardar el programa.");
      setPrograms((current) => form.id ? current.map((program) => program.id === data.program?.id ? data.program : program) as InterventionProgram[] : [data.program as InterventionProgram, ...current]);
      setProgramModal(false);
      onSelectProfile(data.program.profileId || form.profileId || "all");
      onProfilesRefresh();
      notify(form.id ? "Programa y criterios actualizados." : "Programa creado con sus targets en Línea base.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo guardar el programa.");
    } finally { setSaving(false); }
  }

  async function deleteProgram() {
    if (!deleteProgramTarget || deleteText.trim().toUpperCase() !== "ELIMINAR") return;
    setSaving(true);
    try {
      const response = await clientRequest("/api/intervention-programs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_program", id: deleteProgramTarget.id }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo eliminar el programa.");
      setPrograms((current) => current.filter((program) => program.id !== deleteProgramTarget.id));
      setSessions((current) => current.filter((session) => session.programId !== deleteProgramTarget.id));
      setDeleteProgramTarget(null);
      setDeleteText("");
      onProfilesRefresh();
      notify("Programa, targets y sesiones eliminados permanentemente.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo eliminar el programa.");
    } finally { setSaving(false); }
  }

  function updateEditingSessionResult(targetId: string, patch: Partial<InterventionSession["results"][number]>) {
    setEditingSession((current) => current ? ({
      ...current,
      results: current.results.map((result) => result.targetId === targetId ? { ...result, ...patch } : result),
    }) : current);
  }

  async function saveSessionEdits() {
    if (!editingSession) return;
    setSaving(true);
    try {
      const submit = (confirmMasteryRecalculation = false) => clientRequest("/api/intervention-programs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_session", ...editingSession, confirmMasteryRecalculation, recalculationReason: confirmMasteryRecalculation ? "Corrección clínica confirmada por usuario autorizado." : "" }),
      });
      let response = await submit();
      let data = await response.json() as { program?: InterventionProgram; sessions?: InterventionSession[]; error?: string; requiresMasteryRecalculation?: boolean };
      if (response.status === 409 && data.requiresMasteryRecalculation) {
        const confirmed = window.confirm(`${data.error}\n\nSi continúas, el cambio quedará auditado y el evento de dominio y la gráfica acumulativa se recalcularán.`);
        if (!confirmed) return;
        response = await submit(true);
        data = await response.json() as typeof data;
      }
      if (!response.ok || !data.program || !data.sessions) throw new Error(data.error || "No se pudo actualizar la sesión.");
      setPrograms((current) => current.map((program) => program.id === data.program?.id ? data.program : program) as InterventionProgram[]);
      setSessions((current) => [...current.filter((session) => session.programId !== data.program?.id), ...(data.sessions || [])]);
      setEditingSession(null);
      onProfilesRefresh();
      notify("Sesión actualizada; los estados del programa fueron recalculados.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo actualizar la sesión.");
    } finally { setSaving(false); }
  }

  async function deleteSession() {
    if (!deleteSessionTarget || deleteText.trim().toUpperCase() !== "ELIMINAR") return;
    setSaving(true);
    try {
      const submit = (confirmMasteryRecalculation = false) => clientRequest("/api/intervention-programs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete_session", id: deleteSessionTarget.id, confirmMasteryRecalculation, recalculationReason: confirmMasteryRecalculation ? "Eliminación de sesión confirmada por usuario autorizado." : "" }),
      });
      let response = await submit();
      let data = await response.json() as { program?: InterventionProgram; sessions?: InterventionSession[]; error?: string; requiresMasteryRecalculation?: boolean };
      if (response.status === 409 && data.requiresMasteryRecalculation) {
        const confirmed = window.confirm(`${data.error}\n\nSi continúas, el evento de dominio afectado quedará invalidado en auditoría y la gráfica será recalculada.`);
        if (!confirmed) return;
        response = await submit(true);
        data = await response.json() as typeof data;
      }
      if (!response.ok || !data.program || !data.sessions) throw new Error(data.error || "No se pudo eliminar la sesión.");
      setPrograms((current) => current.map((program) => program.id === data.program?.id ? data.program : program) as InterventionProgram[]);
      setSessions((current) => [...current.filter((session) => session.programId !== data.program?.id), ...(data.sessions || [])]);
      setDeleteSessionTarget(null);
      setDeleteText("");
      onProfilesRefresh();
      notify("Sesión eliminada; los estados del programa fueron recalculados.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo eliminar la sesión.");
    } finally { setSaving(false); }
  }

  function openSessionSetup(programId?: string) {
    const selectedProgram = programs.find((program) => program.id === programId)
      || activePrograms.find((program) => program.profileId === selectedProfileId)
      || activePrograms[0];
    if (!selectedProgram?.profileId) { notify("Selecciona un niño con un programa y targets abiertos."); return; }
    setRealSetup({ profileId: selectedProgram?.profileId || "", sessionDate: institutionalToday, contextCategory: "", contextOther: "", noteTemplateId: noteTemplates[0]?.id || DEFAULT_SESSION_NOTE_TEMPLATE.id, selectedTargetIds: [] });
    setRealPreparation(null);
    setRealPreparationLoading(true); setRealPreparationError("");
    setLinkedAppointmentId(null);
    setRealSetupOpen(true);
    setLastTransitions([]);
  }

  function openScheduledSession(appointment: CalendarAppointment) {
    onSelectProfile(appointment.profileId);
    setRealSetup({ profileId: appointment.profileId, sessionDate: appointment.sessionDate, contextCategory: "", contextOther: "", noteTemplateId: noteTemplates[0]?.id || DEFAULT_SESSION_NOTE_TEMPLATE.id, selectedTargetIds: [] });
    setRealPreparation(null);
    setRealPreparationLoading(true); setRealPreparationError("");
    setLinkedAppointmentId(appointment.id);
    setRealSetupOpen(true);
    setLastTransitions([]);
  }

  async function startRealSession() {
    if (!realPreparation || realStarting) return;
    setRealStarting(true);
    try {
      const response = await clientRequest("/api/session-collection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", ...realSetup, appointmentId: linkedAppointmentId }),
      });
      const body = await response.json() as { draft?: CollectionDraft; error?: string };
      if (!response.ok || !body.draft) throw new Error(body.error || "No se pudo iniciar la sesión.");
      setRealSessionDraft(body.draft);
      setRealSetupOpen(false);
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo iniciar la sesión.");
    } finally { setRealStarting(false); }
  }

  function finishRealSession(message: string) {
    setRealSessionDraft(null);
    setRealPreparation(null);
    setLinkedAppointmentId(null);
    setReloadRevision((current) => current + 1);
    onProfilesRefresh();
    notify(message);
  }

  function beginSession() {
    if (!setupProfile || !setupPrograms.length || !selectedNoteTemplate || !setup.context.trim()) {
      notify("Selecciona un niño con programas activos, una plantilla e identifica el contexto de la sesión.");
      return;
    }
    const activeTargets = setupPrograms.flatMap((program) => program.targets.filter((target) => target.state !== "closed"));
    if (!activeTargets.length) {
      notify("Todos los targets de los programas activos están cerrados.");
      return;
    }
    const results = Object.fromEntries(activeTargets.map((target) => [target.id as string, {
      sampled: true,
      value: "",
      correct: "",
      opportunities: target.measurement === "percentage" || target.measurement === "occurrence" ? "" : "1",
      trials: [],
      note: "",
    }]));
    setActiveSession({
      profileId: setupProfile.id,
      programIds: setupPrograms.map((program) => program.id),
      sessionDate: setup.sessionDate,
      context: setup.context.trim(),
      noteTemplateId: selectedNoteTemplate.id,
      noteValues: Object.fromEntries(selectedNoteTemplate.fields.map((field) => [field.id, ""])),
      startedAt: new Date().toISOString(),
      results,
    });
    setFocusedProgramId(setupPrograms[0]?.id || null);
    setFocusedTargetId(activeTargets[0]?.id || null);
    setSessionElapsed(0);
    setRunningTimerTargetId(null);
    setInstructionsOpen(false);
    setSessionNotesOpen(false);
    setFinishReviewOpen(false);
    setExitConfirmOpen(false);
    setSetupOpen(false);
  }

  function updateSessionResult(targetId: string, patch: Partial<SessionResultDraft>) {
    setActiveSession((current) => current ? ({
      ...current,
      results: { ...current.results, [targetId]: { ...current.results[targetId], ...patch } },
    }) : current);
  }

  function computedValue(target: TargetDefinition, result: SessionResultDraft) {
    if (!result.sampled) return null;
    if (target.measurement === "occurrence" || target.measurement === "percentage" && result.trials.length) {
      return result.trials.length ? Math.round((result.trials.reduce<number>((sum, trial) => sum + trial, 0) / result.trials.length) * 1000) / 10 : null;
    }
    if (target.measurement === "percentage") {
      const correct = Number(result.correct);
      const opportunities = Number(result.opportunities);
      return Number.isFinite(correct) && Number.isFinite(opportunities) && opportunities > 0 ? Math.round((correct / opportunities) * 1000) / 10 : null;
    }
    if (result.value === "") return null;
    const value = Number(result.value);
    return Number.isFinite(value) ? value : null;
  }

  function targetOpportunityCount(target: TargetDefinition, result: SessionResultDraft) {
    if (target.measurement === "percentage" || target.measurement === "occurrence") {
      return result.trials.length || Math.max(0, Number(result.opportunities || 0));
    }
    return result.value === "" ? 0 : Math.max(1, Number(result.opportunities || 1));
  }

  function recordTrial(targetId: string, value: 0 | 1) {
    setActiveSession((current) => {
      const draft = current?.results[targetId];
      if (!current || !draft) return current;
      const trials = [...draft.trials, value];
      return { ...current, results: { ...current.results, [targetId]: { ...draft, sampled: true, trials, correct: String(trials.reduce<number>((sum, trial) => sum + trial, 0)), opportunities: String(trials.length) } } };
    });
  }

  function undoTrial(targetId: string) {
    setActiveSession((current) => {
      const draft = current?.results[targetId];
      if (!current || !draft?.trials.length) return current;
      const trials = draft.trials.slice(0, -1);
      return { ...current, results: { ...current.results, [targetId]: { ...draft, trials, correct: String(trials.reduce<number>((sum, trial) => sum + trial, 0)), opportunities: trials.length ? String(trials.length) : "" } } };
    });
  }

  function adjustFrequency(targetId: string, delta: number) {
    setActiveSession((current) => {
      const draft = current?.results[targetId];
      if (!current || !draft) return current;
      const value = Math.max(0, Math.round(Number(draft.value || 0)) + delta);
      return { ...current, results: { ...current.results, [targetId]: { ...draft, sampled: true, value: String(value), opportunities: "1" } } };
    });
  }

  function selectTarget(targetId: string) {
    setRunningTimerTargetId(null);
    setFocusedTargetId(targetId);
  }

  function selectSessionProgram(programId: string) {
    const program = sessionPrograms.find((item) => item.id === programId);
    const firstTarget = program?.targets.find((target) => target.state !== "closed");
    setRunningTimerTargetId(null);
    setInstructionsOpen(false);
    setFocusedProgramId(programId);
    setFocusedTargetId(firstTarget?.id || null);
  }

  function leaveActiveSession() {
    setRunningTimerTargetId(null);
    setSessionElapsed(0);
    setFocusedTargetId(null);
    setFocusedProgramId(null);
    setFinishReviewOpen(false);
    setExitConfirmOpen(false);
    setSessionNotesOpen(false);
    setActiveSession(null);
  }

  async function closeSession() {
    if (!activeSession || !sessionPrograms.length) return;
    const programEntries = sessionPrograms.map((program) => ({
      programId: program.id,
      results: program.targets.filter((target) => target.state !== "closed").map((target) => {
        const draft = activeSession.results[target.id as string];
        return {
          targetId: target.id,
          sampled: draft?.sampled ?? false,
          value: draft ? computedValue(target, draft) : null,
          correct: target.measurement === "occurrence" || target.measurement === "percentage" && Boolean(draft?.trials.length) ? draft?.trials.reduce<number>((sum, trial) => sum + trial, 0) ?? null : draft?.correct === "" ? null : Number(draft?.correct),
          opportunities: target.measurement === "occurrence" || target.measurement === "percentage" && Boolean(draft?.trials.length) ? draft?.trials.length || 0 : Number(draft?.opportunities || 0),
          trials: target.measurement === "occurrence" || target.measurement === "percentage" ? draft?.trials || [] : [],
          note: draft?.note || "",
        };
      }),
    })).filter((entry) => entry.results.some((result) => result.sampled && result.value !== null));
    if (!programEntries.length) {
      notify("Registra al menos un resultado válido antes de cerrar la sesión.");
      return;
    }
    const template = noteTemplates.find((item) => item.id === activeSession.noteTemplateId);
    const missing = template?.fields.filter((field) => field.required && !activeSession.noteValues[field.id]?.trim()) || [];
    if (missing.length) {
      setSessionNotesOpen(true);
      setFinishReviewOpen(false);
      notify(`Completa la nota de sesión: ${missing.map((field) => field.label).join(", ")}.`);
      return;
    }
    setSaving(true);
    try {
      const response = await clientRequest("/api/intervention-programs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "close_session_run", appointmentId: linkedAppointmentId, ...activeSession, programs: programEntries }),
      });
      const data = await response.json() as { programs?: InterventionProgram[]; sessions?: InterventionSession[]; sessionRun?: { id: string }; error?: string };
      if (!response.ok || !data.programs || !data.sessions?.length || !data.sessionRun) throw new Error(data.error || "No se pudo cerrar la sesión.");
      const updatedById = new Map(data.programs.map((program) => [program.id, program]));
      setPrograms((current) => current.map((program) => updatedById.get(program.id) || program));
      setSessions((current) => [...data.sessions as InterventionSession[], ...current]);
      const transitions = data.sessions.flatMap((session) => session.transitions || []);
      setLastTransitions(transitions);
      setActiveSession(null);
      setRunningTimerTargetId(null);
      setSessionElapsed(0);
      setFocusedTargetId(null);
      setFocusedProgramId(null);
      setFinishReviewOpen(false);
      setExitConfirmOpen(false);
      setSessionNotesOpen(false);
      if (linkedAppointmentId) setAppointments((current) => current.map((appointment) => appointment.id === linkedAppointmentId ? { ...appointment, status: "completed", interventionSessionId: data.sessions?.[0]?.id || null } : appointment));
      setLinkedAppointmentId(null);
      onProfilesRefresh();
      notify(transitions.length ? `Sesión cerrada en ${data.sessions.length} programa${data.sessions.length === 1 ? "" : "s"}; estados actualizados según los criterios.` : `Sesión cerrada en ${data.sessions.length} programa${data.sessions.length === 1 ? "" : "s"}; ningún target cambió de estado.`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo cerrar la sesión.");
    } finally { setSaving(false); }
  }

  function updateTemplateField(index: number, patch: Partial<SessionNoteField>) {
    setTemplateDraft((current) => current ? ({ ...current, fields: current.fields.map((field, itemIndex) => itemIndex === index ? { ...field, ...patch } : field) }) : current);
  }

  async function saveNoteTemplate() {
    if (!templateDraft?.name.trim() || templateDraft.fields.some((field) => !field.label.trim())) {
      notify("Escribe el nombre de la plantilla y el título de cada campo.");
      return;
    }
    setSaving(true);
    try {
      const response = await clientRequest("/api/session-note-templates", {
        method: templateDraft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(templateDraft),
      });
      const data = await response.json() as { template?: SessionNoteTemplate; error?: string };
      if (!response.ok || !data.template) throw new Error(data.error || "No se pudo guardar la plantilla.");
      setNoteTemplates((current) => templateDraft.id
        ? current.map((template) => template.id === data.template?.id ? data.template : template) as SessionNoteTemplate[]
        : [...current, data.template as SessionNoteTemplate]);
      setTemplateDraft(null);
      notify(templateDraft.id ? "Plantilla de nota actualizada." : "Plantilla de nota creada desde cero.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo guardar la plantilla.");
    } finally { setSaving(false); }
  }

  async function archiveNoteTemplate(template: SessionNoteTemplate) {
    if (!window.confirm(`¿Archivar la plantilla “${template.name}”? Las notas históricas conservarán la versión utilizada.`)) return;
    setSaving(true);
    try {
      const response = await clientRequest("/api/session-note-templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: template.id, action: "archive" }),
      });
      const data = await response.json() as { templates?: SessionNoteTemplate[]; error?: string };
      if (!response.ok || !data.templates) throw new Error(data.error || "No se pudo archivar la plantilla.");
      setNoteTemplates(data.templates);
      notify("Plantilla archivada; las notas históricas permanecen sin cambios.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo archivar la plantilla.");
    } finally { setSaving(false); }
  }

  function renderSessionGroup(group: { id: string; rows: InterventionSession[] }) {
    const first = group.rows[0];
    const groupPrograms = group.rows.flatMap((session) => {
      const program = programs.find((item) => item.id === session.programId);
      return program ? [program] : [];
    });
    const transitions = group.rows.flatMap((session) => session.transitions);
    const targetCount = group.rows.reduce((sum, session) => sum + session.results.filter((result) => result.sampled).length, 0);
    return <article className="session-history-group" key={group.id}>
      <time>{new Date(`${first.sessionDate}T12:00:00`).toLocaleDateString("es-NI", { day: "2-digit", month: "short", year: "numeric" })}</time>
      <div><strong>{groupPrograms[0]?.participantName || "Sesión clínica"}</strong><small>{first.context} · {groupPrograms.length} programa{groupPrograms.length === 1 ? "" : "s"}</small></div>
      <span>{targetCount} targets</span>
      {transitions.length ? <em>{transitions.length} transición{transitions.length === 1 ? "" : "es"}</em> : <em className="stable">Sin cambios</em>}
      <details><summary>Ver programas</summary><div>{group.rows.map((session) => { const program = programs.find((item) => item.id === session.programId); return <section key={session.id}><div><strong>{program?.name || "Programa"}</strong><small>{session.results.filter((result) => result.sampled).length} targets registrados{session.clinicalSessionRunId ? " · cierre firmado" : ""}</small></div>{canManageSessions && !session.clinicalSessionRunId && <div className="session-row-actions"><button aria-label={`Editar ${program?.name || "programa"}`} title="Editar registro del programa" onClick={() => setEditingSession(JSON.parse(JSON.stringify(session)) as InterventionSession)}><Edit3 size={15}/></button><button className="danger-action" aria-label={`Eliminar ${program?.name || "programa"}`} title="Eliminar registro del programa" onClick={() => { setDeleteSessionTarget(session); setDeleteText(""); }}><Trash2 size={15}/></button></div>}</section>; })}</div></details>
    </article>;
  }

  if (mode === "sessions" && realSessionDraft) return <RealSessionCollector initialDraft={realSessionDraft} notify={notify} onClosed={() => finishRealSession("Sesión firmada y cerrada. Los criterios y fases fueron evaluados.")} onDiscarded={() => finishRealSession("La sesión vacía fue descartada y la cita volvió a estar disponible.")}/>;

  if (loading) return <div className="intervention-loading" role="status"><LoaderCircle className="spin" size={28}/><strong>Cargando programas y sesiones…</strong></div>;
  if (loadError) return <div className="load-error" role="alert"><p>{loadError}</p><button onClick={() => setReloadRevision(current => current + 1)}>Reintentar carga</button></div>;

  if (mode === "sessions" && activeSession && sessionProgram) {
    const visibleTargets = sessionProgram.targets.filter((target) => target.state !== "closed");
    const allSessionTargets = sessionPrograms.flatMap((program) => program.targets.filter((target) => target.state !== "closed"));
    const recorded = allSessionTargets.filter((target) => computedValue(target, activeSession.results[target.id as string]) !== null).length;
    const sufficientSamples = allSessionTargets.filter((target) => {
      const result = activeSession.results[target.id as string];
      return result && targetOpportunityCount(target, result) >= target.criteria[target.state as CriterionStage].minTrials;
    }).length;
    const focusedIndex = Math.max(0, visibleTargets.findIndex((target) => target.id === focusedTargetId));
    const focusedTarget = visibleTargets[focusedIndex] || visibleTargets[0];
    const focusedResult = focusedTarget ? activeSession.results[focusedTarget.id as string] : null;
    const focusedValue = focusedTarget && focusedResult ? computedValue(focusedTarget, focusedResult) : null;
    const focusedCriterion = focusedTarget?.criteria[focusedTarget.state as CriterionStage];
    const focusedOpportunities = focusedTarget && focusedResult ? targetOpportunityCount(focusedTarget, focusedResult) : 0;
    const focusedMinimumMet = Boolean(focusedCriterion && focusedOpportunities >= focusedCriterion.minTrials);
    const focusedCorrect = focusedResult?.trials.reduce<number>((sum, trial) => sum + trial, 0) || 0;
    const activeNoteTemplate = noteTemplates.find((template) => template.id === activeSession.noteTemplateId) || noteTemplates[0] || null;
    const completedNoteFields = activeNoteTemplate?.fields.filter((field) => activeSession.noteValues[field.id]?.trim()).length || 0;
    const hasDraftData = recorded > 0 || Object.values(activeSession.noteValues).some((value) => value.trim()) || Object.values(activeSession.results).some((result) => result.note.trim());
    return <div className="session-collection-overlay">
      <header className="session-command-bar">
        <button className="session-exit-button" onClick={() => hasDraftData ? setExitConfirmOpen(true) : leaveActiveSession()}><ArrowLeft size={18}/><span>Salir</span></button>
        <span className="session-child-mark">{initials(sessionProgram.participantName)}</span>
        <div className="session-command-title"><strong>{sessionProgram.participantName}</strong><small>{sessionPrograms.length} programa{sessionPrograms.length === 1 ? "" : "s"} activo{sessionPrograms.length === 1 ? "" : "s"} · {activeSession.context}</small></div>
        <div className="session-live-clock"><i/><Clock3 size={17}/><div><small>Tiempo de sesión</small><strong>{formatElapsed(sessionElapsed)}</strong></div></div>
        <div className="session-command-progress"><div><span style={{ width: `${allSessionTargets.length ? Math.round((recorded / allSessionTargets.length) * 100) : 0}%` }}/></div><strong>{recorded}/{allSessionTargets.length}</strong><small>targets con datos</small></div>
        <div className="session-command-actions">
          {onRegisterABC && <button className="session-tool-button abc" onClick={() => sessionProgram.profileId && onRegisterABC({ profileId: sessionProgram.profileId, profileName: sessionProgram.participantName, programId: sessionProgram.id, appointmentId: linkedAppointmentId })}><ListTree size={17}/><span>ABC</span></button>}
          <button className={`session-tool-button ${sessionNotesOpen ? "active" : ""}`} onClick={() => setSessionNotesOpen((current) => !current)}><NotebookPen size={17}/><span>Notas</span></button>
          <button className="session-finish-button" onClick={() => { setRunningTimerTargetId(null); setFinishReviewOpen(true); }}><CheckCircle2 size={17}/> Finalizar</button>
        </div>
      </header>

      <nav className="session-program-switcher" aria-label="Programas activos de la sesión">
        <div><small>Programas de esta sesión</small><strong>Cambia de programa sin salir</strong></div>
        {sessionPrograms.map((program, index) => {
          const openTargets = program.targets.filter((target) => target.state !== "closed");
          const programRecorded = openTargets.filter((target) => computedValue(target, activeSession.results[target.id as string]) !== null).length;
          return <button type="button" key={program.id} className={program.id === sessionProgram.id ? "active" : ""} onClick={() => selectSessionProgram(program.id)}><span>{index + 1}</span><div><strong>{program.name}</strong><small>{programRecorded}/{openTargets.length} targets con datos</small></div>{programRecorded > 0 && <CheckCircle2 size={16}/>}</button>;
        })}
      </nav>

      <div className={`session-collection-body ${sessionNotesOpen ? "with-notes" : ""}`}>
        <aside className="session-target-rail">
          <div className="session-program-summary">
            <p className="section-kicker">Programa {Math.max(1, sessionPrograms.findIndex((program) => program.id === sessionProgram.id) + 1)} de {sessionPrograms.length}</p>
            <strong>{sessionProgram.name}</strong>
            <span>{visibleTargets.length} targets disponibles</span>
            <div><button type="button" disabled={sessionPrograms[0]?.id === sessionProgram.id} aria-label="Programa anterior" onClick={() => selectSessionProgram(sessionPrograms[Math.max(0, sessionPrograms.findIndex((program) => program.id === sessionProgram.id) - 1)].id)}><ChevronLeft size={15}/></button><button type="button" disabled={sessionPrograms[sessionPrograms.length - 1]?.id === sessionProgram.id} aria-label="Programa siguiente" onClick={() => selectSessionProgram(sessionPrograms[Math.min(sessionPrograms.length - 1, sessionPrograms.findIndex((program) => program.id === sessionProgram.id) + 1)].id)}><ChevronRight size={15}/></button></div>
          </div>
          <nav aria-label="Targets de la sesión">
            {visibleTargets.map((target) => {
              const result = activeSession.results[target.id as string];
              const value = result ? computedValue(target, result) : null;
              const opportunities = result ? targetOpportunityCount(target, result) : 0;
              const criterion = target.criteria[target.state as CriterionStage];
              const minimumMet = opportunities >= criterion.minTrials;
              const correct = result?.trials.reduce<number>((sum, trial) => sum + trial, 0) || 0;
              return <button type="button" key={target.id} className={`${target.id === focusedTarget?.id ? "active" : ""} ${minimumMet ? "minimum-met" : ""} ${result?.sampled ? "" : "excluded"}`} aria-current={target.id === focusedTarget?.id ? "true" : undefined} onClick={() => selectTarget(target.id as string)}>
                <span className={`target-state ${target.state}`}>{stateLabel(target.state)}</span>
                <strong>{target.code} · {target.name}</strong>
                <small>{target.measurement === "percentage" || target.measurement === "occurrence" ? `${correct}/${result?.trials.length || 0} correctas` : value === null ? "Sin datos" : `${value} ${target.unitLabel}`}</small>
                {minimumMet ? <em><Check size={12}/> Mínimo alcanzado</em> : opportunities > 0 ? <em>{opportunities}/{criterion.minTrials} oportunidades</em> : <em>Pendiente</em>}
              </button>;
            })}
          </nav>
        </aside>

        <main className="session-data-surface">
          <section className="session-program-context">
            <div><Target size={18}/><div><small>Objetivo general</small><p>{sessionProgram.objective}</p></div></div>
            {sessionProgram.instructions && <button type="button" aria-expanded={instructionsOpen} onClick={() => setInstructionsOpen((current) => !current)}><FileText size={16}/> Instrucciones <ChevronDown className={instructionsOpen ? "rotate" : ""} size={16}/></button>}
          </section>
          {instructionsOpen && sessionProgram.instructions && <section className="session-instructions"><strong>Instrucciones del programa</strong><p>{sessionProgram.instructions}</p></section>}

          {focusedTarget && focusedResult && <article className={`focused-target-card ${focusedResult.sampled ? "" : "not-sampled"}`}>
            <header className="focused-target-heading">
              <div><div><span className={`target-state ${focusedTarget.state}`}>{stateLabel(focusedTarget.state)}</span><em>{focusedTarget.code}</em></div><h1>{focusedTarget.name}</h1><p>{focusedTarget.specificObjective}</p></div>
              <label className="sample-toggle"><input type="checkbox" checked={focusedResult.sampled} onChange={(event) => { setRunningTimerTargetId(null); updateSessionResult(focusedTarget.id as string, { sampled: event.target.checked }); }}/><span>Trabajado hoy</span></label>
            </header>

            <div className={`session-criterion-status ${focusedMinimumMet ? "ready" : ""}`}>
              <SlidersHorizontal size={17}/><div><small>Criterio vigente</small><strong>{criterionText(focusedTarget)}</strong></div><span>{focusedMinimumMet ? <><CheckCircle2 size={15}/> Muestra suficiente</> : <>{focusedOpportunities}/{focusedCriterion?.minTrials || 0} oportunidades mínimas</>}</span>
            </div>

            {focusedResult.sampled ? <div className="session-capture-area">
              <div className="capture-method-heading"><div><small>Método de registro</small><strong>{measurementLabel(focusedTarget.measurement)}</strong></div>{focusedValue !== null && <span>{focusedValue} {focusedTarget.unitLabel}</span>}</div>

              {(focusedTarget.measurement === "percentage" || focusedTarget.measurement === "occurrence") && <>
                <div className="trial-live-summary"><div><strong>{focusedCorrect}</strong><small>Correctas</small></div><div><strong>{focusedResult.trials.length}</strong><small>Ensayos</small></div><div><strong>{focusedValue ?? 0}%</strong><small>Resultado</small></div></div>
                <div className="trial-response-buttons">
                  <button type="button" className="correct" onClick={() => recordTrial(focusedTarget.id as string, 1)}><Check size={25}/><span><strong>Correcto</strong><small>Registrar respuesta</small></span></button>
                  <button type="button" className="incorrect" onClick={() => recordTrial(focusedTarget.id as string, 0)}><X size={25}/><span><strong>Incorrecto</strong><small>Registrar respuesta</small></span></button>
                </div>
                <div className="trial-requirement-meter"><div><span style={{ width: `${Math.min(100, (focusedResult.trials.length / Math.max(1, focusedCriterion?.minTrials || 1)) * 100)}%` }}/></div><small>{focusedMinimumMet ? "La muestra mínima ya fue alcanzada. Puedes continuar registrando ensayos." : `Faltan ${Math.max(0, (focusedCriterion?.minTrials || 0) - focusedResult.trials.length)} ensayos para evaluar el criterio.`}</small></div>
                <div className="trial-history-heading"><strong>Ensayos de esta sesión</strong><button type="button" disabled={!focusedResult.trials.length} onClick={() => undoTrial(focusedTarget.id as string)}><RotateCcw size={14}/> Deshacer último</button></div>
                {focusedResult.trials.length ? <div className="trial-history-grid" aria-label="Ensayos registrados">{focusedResult.trials.map((trial, trialIndex) => <div className={trial === 1 ? "correct" : "incorrect"} key={`${focusedTarget.id}-trial-${trialIndex}`}><span>{trialIndex + 1}</span><button type="button" aria-label={`Cambiar resultado del ensayo ${trialIndex + 1}`} onClick={() => updateSessionResult(focusedTarget.id as string, { trials: focusedResult.trials.map((item, index) => index === trialIndex ? item === 1 ? 0 : 1 : item) })}>{trial === 1 ? <Check size={16}/> : <X size={16}/>}</button><button type="button" aria-label={`Eliminar ensayo ${trialIndex + 1}`} onClick={() => updateSessionResult(focusedTarget.id as string, { trials: focusedResult.trials.filter((_, index) => index !== trialIndex) })}><Trash2 size={13}/></button></div>)}</div> : <p className="trial-history-empty">Toca Correcto o Incorrecto para registrar el primer ensayo.</p>}
              </>}

              {focusedTarget.measurement === "frequency" && <div className="frequency-capture"><div><small>Ocurrencias registradas</small><strong>{Math.max(0, Number(focusedResult.value || 0))}</strong></div><button type="button" className="frequency-add" onClick={() => adjustFrequency(focusedTarget.id as string, 1)}><Plus size={26}/> Registrar ocurrencia</button><button type="button" className="capture-undo" disabled={Number(focusedResult.value || 0) <= 0} onClick={() => adjustFrequency(focusedTarget.id as string, -1)}><RotateCcw size={15}/> Deshacer</button></div>}

              {(focusedTarget.measurement === "duration" || focusedTarget.measurement === "latency") && <div className="timer-capture"><small>{focusedTarget.measurement === "duration" ? "Tiempo acumulado" : "Latencia observada"}</small><strong>{formatElapsed(Math.max(0, Math.round(Number(focusedResult.value || 0))))}</strong><div><button type="button" className={runningTimerTargetId === focusedTarget.id ? "pause" : "start"} onClick={() => setRunningTimerTargetId((current) => current === focusedTarget.id ? null : focusedTarget.id as string)}>{runningTimerTargetId === focusedTarget.id ? <><Pause size={18}/> Pausar</> : <><Play size={18}/> Iniciar cronómetro</>}</button><button type="button" onClick={() => { setRunningTimerTargetId(null); updateSessionResult(focusedTarget.id as string, { value: "", opportunities: "1" }); }}><RotateCcw size={16}/> Reiniciar</button></div><label><span>Ajuste manual en segundos</span><input type="number" min="0" step="1" value={focusedResult.value} onChange={(event) => { setRunningTimerTargetId(null); updateSessionResult(focusedTarget.id as string, { value: event.target.value, opportunities: "1" }); }}/></label></div>}

              <label className="focused-target-note"><span>Nota breve del target <em>Opcional</em></span><input value={focusedResult.note} onChange={(event) => updateSessionResult(focusedTarget.id as string, { note: event.target.value })} placeholder="Ayuda utilizada, contexto o variable relevante"/></label>
            </div> : <div className="target-excluded-state"><CircleDashed size={28}/><strong>Target no trabajado en esta sesión</strong><p>No se enviará un resultado ni afectará la evaluación del criterio.</p><button type="button" onClick={() => updateSessionResult(focusedTarget.id as string, { sampled: true })}>Incluir target</button></div>}

            <footer className="target-navigation"><span>Target {focusedIndex + 1} de {visibleTargets.length}</span><div><button type="button" disabled={focusedIndex === 0} onClick={() => selectTarget(visibleTargets[focusedIndex - 1]?.id as string)}><ChevronLeft size={16}/> Anterior</button><button type="button" disabled={focusedIndex >= visibleTargets.length - 1} onClick={() => selectTarget(visibleTargets[focusedIndex + 1]?.id as string)}>Siguiente <ChevronRight size={16}/></button></div></footer>
          </article>}
        </main>

        {sessionNotesOpen && <aside className="session-note-drawer"><header><div><small>Durante la sesión</small><strong>Nota de sesión</strong></div><button type="button" aria-label="Minimizar notas" onClick={() => setSessionNotesOpen(false)}><X size={18}/></button></header><div className="session-note-template-name"><NotebookPen size={16}/><div><strong>{activeNoteTemplate?.name || "Plantilla de sesión"}</strong><small>{completedNoteFields}/{activeNoteTemplate?.fields.length || 0} campos completados</small></div></div><p>{activeNoteTemplate?.description}</p><div className="session-note-fields">{activeNoteTemplate?.fields.map((field, index) => <label key={field.id}><span>{field.label}{field.required ? <em>Obligatorio</em> : <small>Opcional</small>}</span>{field.guidance && <small>{field.guidance}</small>}<textarea autoFocus={index === 0} value={activeSession.noteValues[field.id] || ""} onChange={(event) => setActiveSession({ ...activeSession, noteValues: { ...activeSession.noteValues, [field.id]: event.target.value } })} placeholder="Escribe información clínica observable…"/></label>)}</div><small>La nota y la versión de la plantilla se guardarán al cerrar.</small></aside>}
      </div>

      {finishReviewOpen && <ModalLayer onDismiss={() => setFinishReviewOpen(false)} className="session-modal-backdrop"><section className="session-review-modal" role="dialog" aria-modal="true" aria-labelledby="finish-session-title"><header><div><p className="section-kicker">Cierre de sesión</p><h2 id="finish-session-title">Revisar la sesión completa</h2></div><button type="button" aria-label="Volver a la sesión" onClick={() => setFinishReviewOpen(false)}><X size={19}/></button></header><div className="session-review-summary"><div><strong>{formatElapsed(sessionElapsed)}</strong><small>Duración</small></div><div><strong>{recorded}/{allSessionTargets.length}</strong><small>Targets con datos</small></div><div><strong>{sufficientSamples}</strong><small>Muestras suficientes</small></div><div><strong>{sessionPrograms.filter((program) => program.targets.some((target) => target.state !== "closed" && computedValue(target, activeSession.results[target.id as string]) !== null)).length}/{sessionPrograms.length}</strong><small>Programas trabajados</small></div></div><div className="session-review-programs">{sessionPrograms.map((program) => { const openTargets = program.targets.filter((target) => target.state !== "closed"); const programRecorded = openTargets.filter((target) => computedValue(target, activeSession.results[target.id as string]) !== null); return <button type="button" key={program.id} onClick={() => { selectSessionProgram(program.id); setFinishReviewOpen(false); }}><div><strong>{program.name}</strong><small>{programRecorded.length}/{openTargets.length} targets con datos</small></div><ChevronRight size={16}/></button>; })}</div><button type="button" className={`session-review-note-status ${activeNoteTemplate?.fields.every((field) => !field.required || activeSession.noteValues[field.id]?.trim()) ? "complete" : "incomplete"}`} onClick={() => { setFinishReviewOpen(false); setSessionNotesOpen(true); }}><NotebookPen size={18}/><div><strong>{activeNoteTemplate?.name || "Nota de sesión"}</strong><small>{completedNoteFields}/{activeNoteTemplate?.fields.length || 0} campos completados · abrir para revisar</small></div><ChevronRight size={16}/></button><div className="session-review-warning"><SlidersHorizontal size={16}/><p>Al cerrar, CIE Nexus guardará una sola sesión terapéutica y conservará cada resultado dentro de su programa. Una muestra insuficiente se guarda, pero no avanza el dominio.</p></div><footer><button type="button" className="secondary-formation-button" onClick={() => setFinishReviewOpen(false)}>Continuar registrando</button><button type="button" className="primary-formation-button" disabled={saving || recorded === 0} onClick={closeSession}>{saving ? <LoaderCircle className="spin" size={16}/> : <CheckCircle2 size={16}/>} Cerrar sesión completa</button></footer></section></ModalLayer>}

      {exitConfirmOpen && <ModalLayer onDismiss={() => setExitConfirmOpen(false)} className="session-modal-backdrop"><section className="session-exit-modal" role="alertdialog" aria-modal="true" aria-labelledby="exit-session-title"><span><ArrowLeft size={22}/></span><h2 id="exit-session-title">¿Salir sin cerrar la sesión?</h2><p>Los datos que todavía no se han cerrado no se guardarán. Puedes continuar registrando o descartarlos y volver.</p><div><button type="button" className="secondary-formation-button" onClick={() => setExitConfirmOpen(false)}>Continuar sesión</button><button type="button" className="danger-button" onClick={leaveActiveSession}>Descartar y salir</button></div></section></ModalLayer>}
    </div>;
  }

  if (mode === "programs") {
    const states = Object.fromEntries(STATE_ORDER.map((state) => [state, allTargets.filter((target) => target.state === state).length]));
    return <>
      <div className="formation-heading"><div><p className="section-kicker">Programas de intervención</p><h1>Objetivos que pueden medirse por sesión</h1><p>Cada programa conserva un objetivo general; cada target define el desempeño específico, su medición y sus criterios de avance.</p></div>{canManagePrograms && <button className="primary-formation-button" onClick={openNewProgram}><Plus size={17}/> Crear programa</button>}</div>
      <section className="target-lifecycle" aria-label="Estados de los targets">
        {STATE_ORDER.map((state, index) => <div key={state} className={state}><span>{states[state] || 0}</span><strong>{stateLabel(state)}</strong>{index < STATE_ORDER.length - 1 && <ArrowRight size={16}/>}</div>)}
      </section>
      <section className="baseline-branch-note"><Layers3 size={20}/><div><strong>La Línea base tiene dos salidas</strong><p>Al completar su ventana de observación, un target pasa directamente a <b>Cerrado</b> si cumple el criterio; si no lo cumple, entra en <b>Adquisición</b>. Las demás transiciones avanzan secuencialmente.</p></div></section>
      {activePrograms.length ? <div className="intervention-program-grid">{activePrograms.map((program) => {
        const expanded = expandedProgramId === program.id;
        return <article className={`intervention-program-card ${expanded ? "expanded" : ""}`} key={program.id}>
          <header><div><p>{program.site} · {program.participantName}</p><h2>{program.name}</h2></div>{canManagePrograms && <div className="program-card-actions"><button className="icon-formation-button" aria-label={`Editar ${program.name}`} title="Editar" onClick={() => openEditProgram(program)}><Edit3 size={17}/></button><button className="icon-formation-button danger-action" aria-label={`Eliminar ${program.name}`} title="Eliminar" onClick={() => { setDeleteProgramTarget(program); setDeleteText(""); }}><Trash2 size={17}/></button></div>}</header>
          <div className="program-general-objective"><small>Objetivo general</small><p>{program.objective}</p></div>
          <div className="program-state-summary">{STATE_ORDER.map((state) => { const count = program.targets.filter((target) => target.state === state).length; return count ? <span className={`target-state ${state}`} key={state}>{count} {stateLabel(state)}</span> : null; })}</div>
          <footer><span><Target size={15}/> {program.targets.length} target{program.targets.length === 1 ? "" : "s"}</span><button onClick={() => setExpandedProgramId(expanded ? null : program.id)}>Ver targets <ChevronDown size={15}/></button>{onOpenProgramGraph && <button onClick={() => onOpenProgramGraph(program.id)}><LineChart size={15}/> Gráfica</button>}</footer>
          {expanded && <div className="program-target-list">{program.targets.map((target) => <div key={target.id}><span className={`target-state ${target.state}`}>{stateLabel(target.state)}</span><div><strong>{target.code} · {target.name}</strong><p>{target.specificObjective}</p><small>{measurementLabel(target.measurement)} · {criterionText(target)}</small></div></div>)}</div>}
        </article>;
      })}</div> : <div className="intervention-empty"><CircleDashed size={30}/><strong>Aún no hay programas de intervención</strong><p>{canManagePrograms ? "Crea el primero con su objetivo general, targets y criterios por etapa." : "No hay programas asignados a los niños que puedes consultar."}</p>{canManagePrograms && <button className="primary-formation-button" onClick={openNewProgram}><Plus size={16}/> Crear primer programa</button>}</div>}
      {programModal && <ProgramModal form={form} cycles={cycles} profiles={activeProfiles} saving={saving} onChange={setForm} onTargetChange={updateTarget} onCriterionChange={updateCriterion} onAddTarget={addTarget} onRemoveTarget={removeTarget} onClose={() => setProgramModal(false)} onSave={saveProgram}/>}
    </>;
  }

  if (historyOnly) return <>
    <div className="formation-heading"><div><p className="section-kicker">Historial clínico</p><h1>Sesiones finalizadas</h1><p>Consulta los datos, programas trabajados, notas y transiciones conservadas en el expediente del niño.</p></div></div>
    <section className="recent-sessions-panel formation-panel"><div className="panel-title"><div><p className="section-kicker">Atención registrada</p><h2>Sesiones cerradas</h2><p className="clinical-session-counts">Encuentros cerrados: {sessionSummary.sessionCount} · Registros por programa: {sessionSummary.programRecordCount}</p></div><Clock3 size={18}/></div>{visibleSessionGroups.length ? <div className="recent-session-list">{visibleSessionGroups.map(renderSessionGroup)}</div> : <div className="intervention-empty compact"><Clock3 size={27}/><strong>Aún no hay sesiones cerradas para este niño</strong></div>}</section>
    {editingSession && (() => { const program = programs.find((item) => item.id === editingSession.programId); return <ModalLayer onDismiss={() => setEditingSession(null)} className="modal-backdrop"><section className="session-edit-modal" role="dialog" aria-modal="true"><div className="modal-title"><div><p className="section-kicker">Sesión cerrada</p><h2>Editar sesión</h2></div><button aria-label="Cerrar" onClick={() => setEditingSession(null)}><X size={19}/></button></div><div className="session-edit-fields"><label><span>Fecha</span><input type="date" disabled={Boolean(editingSession.clinicalSessionRunId)} value={editingSession.sessionDate} onChange={(event) => setEditingSession({ ...editingSession, sessionDate: event.target.value })}/></label><label><span>Contexto</span><input disabled={Boolean(editingSession.clinicalSessionRunId)} value={editingSession.context} onChange={(event) => setEditingSession({ ...editingSession, context: event.target.value })}/></label><label className="field-wide"><span>Nota de sesión</span><textarea disabled={Boolean(editingSession.clinicalSessionRunId)} value={editingSession.notes} onChange={(event) => setEditingSession({ ...editingSession, notes: event.target.value })}/>{editingSession.clinicalSessionRunId && <small>Edita aquí únicamente los datos de este programa; la nota y el contexto pertenecen a la sesión completa.</small>}</label></div><div className="session-edit-results">{editingSession.results.map((result) => { const target = program?.targets.find((item) => item.id === result.targetId); return <article key={result.targetId}><div><strong>{target ? `${target.code} · ${target.name}` : "Target"}</strong><small>{target ? measurementLabel(target.measurement) : "Resultado registrado"}</small>{result.criterionReason && <em className={`criterion-result ${result.criterionStatus}`}>{result.criterionReason}</em>}</div>{target?.measurement === "occurrence" ? <div className="session-edit-trials"><strong>{result.trials?.reduce<number>((sum, trial) => sum + trial, 0) || 0}/{result.trials?.length || 0}</strong><button type="button" onClick={() => updateEditingSessionResult(result.targetId, { trials: [...(result.trials || []), 1] })}><Check size={13}/> Correcto</button><button type="button" onClick={() => updateEditingSessionResult(result.targetId, { trials: [...(result.trials || []), 0] })}><X size={13}/> Incorrecto</button><button type="button" disabled={!result.trials?.length} onClick={() => updateEditingSessionResult(result.targetId, { trials: (result.trials || []).slice(0, -1) })}><Trash2 size={13}/> Quitar último</button></div> : target?.measurement === "percentage" ? <><label><span>Correctas</span><input type="number" min="0" disabled={!result.sampled} value={result.correct ?? ""} onChange={(event) => updateEditingSessionResult(result.targetId, { correct: event.target.value === "" ? null : Number(event.target.value) })}/></label><label><span>Oportunidades</span><input type="number" min="0" disabled={!result.sampled} value={result.opportunities} onChange={(event) => updateEditingSessionResult(result.targetId, { opportunities: Number(event.target.value) })}/></label></> : <><label><span>Valor</span><input type="number" step="any" disabled={!result.sampled} value={result.value ?? ""} onChange={(event) => updateEditingSessionResult(result.targetId, { value: event.target.value === "" ? null : Number(event.target.value) })}/></label><label><span>Oportunidades</span><input type="number" min="0" disabled={!result.sampled} value={result.opportunities} onChange={(event) => updateEditingSessionResult(result.targetId, { opportunities: Number(event.target.value) })}/></label></>}<label><span>Nota</span><input disabled={!result.sampled} value={result.note} onChange={(event) => updateEditingSessionResult(result.targetId, { note: event.target.value })}/></label></article>; })}</div><div className="modal-actions"><button className="secondary-formation-button" onClick={() => setEditingSession(null)}>Cancelar</button><button className="primary-formation-button" disabled={saving} onClick={saveSessionEdits}>{saving ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>} Guardar cambios</button></div></section></ModalLayer>; })()}
    {deleteSessionTarget && <ModalLayer onDismiss={() => setDeleteSessionTarget(null)} className="modal-backdrop"><section className="confirm-modal" role="alertdialog" aria-modal="true"><span className="danger-mark"><Trash2 size={23}/></span><h2>Eliminar sesión permanentemente</h2><p>La sesión del {new Date(`${deleteSessionTarget.sessionDate}T12:00:00`).toLocaleDateString("es-NI")} será eliminada y el programa se recalculará con la evidencia restante.</p><label><span>Escribe ELIMINAR para confirmar</span><input autoFocus value={deleteText} onChange={(event) => setDeleteText(event.target.value)}/></label><div><button className="secondary-formation-button" onClick={() => setDeleteSessionTarget(null)}>Cancelar</button><button className="danger-button" disabled={deleteText.trim().toUpperCase() !== "ELIMINAR" || saving} onClick={deleteSession}><Trash2 size={16}/> Eliminar permanentemente</button></div></section></ModalLayer>}
  </>;

  return <>
    <div className="formation-heading"><div><p className="section-kicker">Sesiones</p><h1>Una sola hoja de datos para toda la terapia</h1><p>{canRecordSessions ? "Abre al niño una vez, cambia entre todos sus programas activos y finaliza una única sesión clínica." : "Consulta las sesiones registradas dentro de tu alcance."}</p></div><div className="session-heading-actions">{canManageSessionNoteTemplates && <button className="secondary-formation-button" onClick={() => setTemplateManagerOpen(true)}><NotebookPen size={16}/> Plantillas de nota</button>}{canRecordSessions && allowAdHocSessions && <button className="primary-formation-button" disabled={!activePrograms.length} onClick={() => openSessionSetup()}><Play size={17}/> Nueva sesión</button>}</div></div>
    <section className="formation-panel assigned-session-panel"><div className="panel-title"><div><p className="section-kicker">Agenda asignada</p><h2>Sesiones programadas</h2></div><CalendarDays size={18}/></div>{scopedAppointments.filter((appointment) => appointment.status === "scheduled" || appointment.status === "in_progress").length ? <div>{scopedAppointments.filter((appointment) => appointment.status === "scheduled" || appointment.status === "in_progress").slice(0, 10).map((appointment) => <article key={appointment.id}><time><strong>{new Date(`${appointment.sessionDate}T12:00:00`).toLocaleDateString("es-NI", { day: "2-digit", month: "short" })}</strong><span>{appointment.startTime}–{appointment.endTime}</span></time><div><strong>{appointment.profileName}</strong><small>{appointment.sessionType} · {appointment.site}</small></div><button className="primary-formation-button" disabled={!canRecordSessions} onClick={() => openScheduledSession(appointment)}><Play size={14}/> Ingresar</button></article>)}</div> : <div className="intervention-empty compact"><CalendarDays size={25}/><strong>No hay sesiones programadas en tu agenda.</strong></div>}</section>
    {lastTransitions.length > 0 && <section className="transition-result-banner"><CheckCircle2 size={22}/><div><strong>{lastTransitions.length} cambio{lastTransitions.length === 1 ? "" : "s"} de estado aplicado{lastTransitions.length === 1 ? "" : "s"}</strong>{lastTransitions.map((transition) => <p key={transition.targetId}>{transition.code} · {transition.targetName}: <b>{stateLabel(transition.from)}</b> → <b>{stateLabel(transition.to)}</b></p>)}</div><button aria-label="Cerrar resumen" onClick={() => setLastTransitions([])}><X size={17}/></button></section>}
    <section className="session-programs-panel">
      <div className="panel-title"><div><p className="section-kicker">Programas disponibles</p><h2>Todos se integran en la sesión del niño</h2></div><span>{activePrograms.length} activos</span></div>
      {activePrograms.length ? <div className="session-program-list">{activePrograms.map((program) => {
        const openTargets = program.targets.filter((target) => target.state !== "closed");
        const count = visibleSessions.filter((session) => session.programId === program.id).length;
        return <article key={program.id}><div className="session-program-icon"><ClipboardCheck size={20}/></div><div><small>{program.site} · {program.participantName}</small><strong>{program.name}</strong><p>{openTargets.length} targets abiertos · {count} registros por programa</p></div><div className="mini-state-stack">{openTargets.slice(0, 3).map((target) => <span className={`target-state ${target.state}`} key={target.id}>{target.code} · {stateLabel(target.state)}</span>)}</div>{canRecordSessions && allowAdHocSessions && <button className="primary-formation-button" disabled={!openTargets.length} onClick={() => openSessionSetup(program.id)}>{openTargets.length ? <><Play size={15}/> Abrir sesión del niño</> : <><CheckCircle2 size={15}/> Completo</>}</button>}</article>;
      })}</div> : <div className="intervention-empty compact"><CircleDashed size={28}/><strong>No hay programas disponibles</strong><p>Crea un programa y sus targets antes de iniciar una sesión.</p></div>}
    </section>
    <section className="recent-sessions-panel formation-panel"><div className="panel-title"><div><p className="section-kicker">Historial</p><h2>Sesiones cerradas</h2><p className="clinical-session-counts">Encuentros cerrados: {sessionSummary.sessionCount} · Registros por programa: {sessionSummary.programRecordCount}</p></div><Clock3 size={18}/></div>{visibleSessionGroups.length ? <div className="recent-session-list">{visibleSessionGroups.slice(0, 12).map(renderSessionGroup)}</div> : <div className="intervention-empty compact"><Clock3 size={27}/><strong>Aún no hay sesiones cerradas</strong></div>}</section>

    {realSetupOpen && <RealSessionSetup error={realPreparationError} onRetry={() => setPreparationRevision(current => current + 1)} preparation={realPreparation} loading={realPreparationLoading} value={realSetup} starting={realStarting} profileOptions={sessionProfileOptions} onChange={(value) => { if (value.profileId !== realSetup.profileId) { setRealPreparation(null); setRealPreparationLoading(true); } setRealSetup(value); }} onClose={() => { if (realStarting) return; setRealSetupOpen(false); setRealPreparation(null); setRealPreparationLoading(false); setLinkedAppointmentId(null); }} onStart={startRealSession}/>}
    {setupOpen && <ModalLayer onDismiss={() => { setSetupOpen(false); setLinkedAppointmentId(null); }} className="modal-backdrop"><section className="session-setup-modal" role="dialog" aria-modal="true" aria-labelledby="session-setup-title"><div className="modal-title"><div><p className="section-kicker">{linkedAppointmentId ? "Sesión programada" : "Nueva sesión"}</p><h2 id="session-setup-title">Preparar hoja de datos</h2></div><button aria-label="Cerrar" onClick={() => { setSetupOpen(false); setLinkedAppointmentId(null); }}><X size={19}/></button></div><p className="modal-intro">La sesión incluirá automáticamente todos los programas activos del niño. El contexto permite evaluar criterios de generalización sin confundir escenarios.</p><div className="session-setup-form"><label><span>Niño</span><select disabled={Boolean(linkedAppointmentId)} value={setup.profileId} onChange={(event) => setSetup({ ...setup, profileId: event.target.value })}><option value="">Seleccionar niño</option>{activeProfiles.filter((profile) => programs.some((program) => program.profileId === profile.id && program.status === "active" && program.targets.some((target) => target.state !== "closed"))).map((profile) => <option value={profile.id} key={profile.id}>{profile.fullName} · {profile.site}</option>)}</select></label><label><span>Fecha</span><input type="date" disabled={Boolean(linkedAppointmentId)} value={setup.sessionDate} onChange={(event) => setSetup({ ...setup, sessionDate: event.target.value })}/></label><label className="field-wide"><span>Contexto de la sesión</span><input autoFocus value={setup.context} onChange={(event) => setSetup({ ...setup, context: event.target.value })} placeholder="Ej. Terapia individual, sede León"/></label><label className="field-wide"><span>Plantilla de nota</span><select value={setup.noteTemplateId} onChange={(event) => setSetup({ ...setup, noteTemplateId: event.target.value })}>{noteTemplates.map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}</select>{selectedNoteTemplate && <small>{selectedNoteTemplate.description}</small>}</label></div>{setupProfile && <div className="setup-program-summary"><Layers3 size={18}/><div><strong>{setupPrograms.length} programa{setupPrograms.length === 1 ? "" : "s"} · {setupPrograms.reduce((sum, program) => sum + program.targets.filter((target) => target.state !== "closed").length, 0)} targets abiertos</strong><p>{setupPrograms.map((program) => program.name).join(" · ") || "No hay programas activos disponibles."}</p></div></div>}<div className="modal-actions"><button className="secondary-formation-button" onClick={() => { setSetupOpen(false); setLinkedAppointmentId(null); }}>Cancelar</button><button className="primary-formation-button" disabled={!setupPrograms.length || !selectedNoteTemplate} onClick={beginSession}><Play size={16}/> Iniciar sesión completa</button></div></section></ModalLayer>}
    {templateManagerOpen && canManageSessionNoteTemplates && <ModalLayer onDismiss={() => { setTemplateManagerOpen(false); setTemplateDraft(null); }} className="modal-backdrop"><section className="session-template-manager" role="dialog" aria-modal="true" aria-labelledby="session-template-title"><div className="modal-title"><div><p className="section-kicker">Dirección Clínica</p><h2 id="session-template-title">Plantillas de notas de sesión</h2></div><button aria-label="Cerrar" onClick={() => { setTemplateManagerOpen(false); setTemplateDraft(null); }}><X size={19}/></button></div>{templateDraft ? <div className="session-template-editor"><div className="session-template-main-fields"><label><span>Nombre de la plantilla</span><input autoFocus value={templateDraft.name} onChange={(event) => setTemplateDraft({ ...templateDraft, name: event.target.value })} placeholder="Ej. Nota para intervención temprana"/></label><label><span>Descripción</span><textarea value={templateDraft.description} onChange={(event) => setTemplateDraft({ ...templateDraft, description: event.target.value })} placeholder="Cuándo debe utilizarse esta plantilla"/></label></div><div className="session-template-fields-heading"><div><strong>Campos de la nota</strong><small>Define qué debe documentar el profesional y qué respuestas son obligatorias.</small></div><button className="secondary-formation-button" onClick={() => setTemplateDraft({ ...templateDraft, fields: [...templateDraft.fields, { id: crypto.randomUUID(), label: "", guidance: "", required: false }] })}><Plus size={15}/> Añadir campo</button></div><div className="session-template-field-list">{templateDraft.fields.map((field, index) => <article key={field.id}><span>{index + 1}</span><div><label><span>Título del campo</span><input value={field.label} onChange={(event) => updateTemplateField(index, { label: event.target.value })} placeholder="Información que debe registrarse"/></label><label><span>Guía para el profesional</span><textarea value={field.guidance} onChange={(event) => updateTemplateField(index, { guidance: event.target.value })} placeholder="Indicaciones breves y clínicas"/></label><label className="criterion-checkbox"><input type="checkbox" checked={field.required} onChange={(event) => updateTemplateField(index, { required: event.target.checked })}/><span>Campo obligatorio para cerrar la sesión</span></label></div><button className="icon-danger" aria-label={`Eliminar campo ${index + 1}`} disabled={templateDraft.fields.length === 1} onClick={() => setTemplateDraft({ ...templateDraft, fields: templateDraft.fields.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={16}/></button></article>)}</div><footer><button className="secondary-formation-button" onClick={() => setTemplateDraft(null)}>Volver</button><button className="primary-formation-button" disabled={saving} onClick={saveNoteTemplate}>{saving ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>} Guardar plantilla</button></footer></div> : <><div className="session-template-manager-heading"><p>La plantilla seleccionada queda copiada dentro de cada nota cerrada. Los cambios futuros no alteran el historial.</p><button className="primary-formation-button" onClick={() => setTemplateDraft(blankSessionNoteTemplate())}><Plus size={16}/> Crear desde cero</button></div><div className="session-template-list">{noteTemplates.map((template) => <article key={template.id}><span className={template.builtIn ? "built-in" : "custom"}><NotebookPen size={18}/></span><div><div><strong>{template.name}</strong>{template.builtIn && <em>Predeterminada</em>}</div><p>{template.description}</p><small>{template.fields.length} campos · {template.fields.filter((field) => field.required).length} obligatorios</small></div>{!template.builtIn && <div><button aria-label={`Editar ${template.name}`} onClick={() => setTemplateDraft(JSON.parse(JSON.stringify(template)) as SessionNoteTemplateDraft)}><Edit3 size={16}/></button><button className="danger-action" aria-label={`Archivar ${template.name}`} onClick={() => archiveNoteTemplate(template)}><Trash2 size={16}/></button></div>}</article>)}</div></>}</section></ModalLayer>}
    {editingSession && (() => { const program = programs.find((item) => item.id === editingSession.programId); return <ModalLayer onDismiss={() => setEditingSession(null)} className="modal-backdrop"><section className="session-edit-modal" role="dialog" aria-modal="true" aria-labelledby="session-edit-title"><div className="modal-title"><div><p className="section-kicker">Sesión cerrada</p><h2 id="session-edit-title">Editar sesión</h2></div><button aria-label="Cerrar" onClick={() => setEditingSession(null)}><X size={19}/></button></div><div className="session-edit-fields"><label><span>Fecha</span><input type="date" disabled={Boolean(editingSession.clinicalSessionRunId)} value={editingSession.sessionDate} onChange={(event) => setEditingSession({ ...editingSession, sessionDate: event.target.value })}/></label><label><span>Contexto</span><input disabled={Boolean(editingSession.clinicalSessionRunId)} value={editingSession.context} onChange={(event) => setEditingSession({ ...editingSession, context: event.target.value })}/></label><label className="field-wide"><span>Nota de sesión</span><textarea disabled={Boolean(editingSession.clinicalSessionRunId)} value={editingSession.notes} onChange={(event) => setEditingSession({ ...editingSession, notes: event.target.value })}/>{editingSession.clinicalSessionRunId && <small>Edita aquí únicamente los datos de este programa; la nota y el contexto pertenecen a la sesión completa.</small>}</label></div><div className="session-edit-results">{editingSession.results.map((result) => { const target = program?.targets.find((item) => item.id === result.targetId); return <article key={result.targetId}><div><strong>{target ? `${target.code} · ${target.name}` : "Target"}</strong><small>{target ? measurementLabel(target.measurement) : "Resultado registrado"}</small>{result.criterionReason && <em className={`criterion-result ${result.criterionStatus}`}>{result.criterionReason}</em>}</div>{target?.measurement === "occurrence" ? <div className="session-edit-trials"><strong>{result.trials?.reduce<number>((sum, trial) => sum + trial, 0) || 0}/{result.trials?.length || 0}</strong><button type="button" onClick={() => updateEditingSessionResult(result.targetId, { trials: [...(result.trials || []), 1] })}><Check size={13}/> Correcto</button><button type="button" onClick={() => updateEditingSessionResult(result.targetId, { trials: [...(result.trials || []), 0] })}><X size={13}/> Incorrecto</button><button type="button" disabled={!result.trials?.length} onClick={() => updateEditingSessionResult(result.targetId, { trials: (result.trials || []).slice(0, -1) })}><Trash2 size={13}/> Quitar último</button></div> : target?.measurement === "percentage" ? <><label><span>Correctas</span><input type="number" min="0" disabled={!result.sampled} value={result.correct ?? ""} onChange={(event) => updateEditingSessionResult(result.targetId, { correct: event.target.value === "" ? null : Number(event.target.value) })}/></label><label><span>Oportunidades</span><input type="number" min="0" disabled={!result.sampled} value={result.opportunities} onChange={(event) => updateEditingSessionResult(result.targetId, { opportunities: Number(event.target.value) })}/></label></> : <><label><span>Valor</span><input type="number" step="any" disabled={!result.sampled} value={result.value ?? ""} onChange={(event) => updateEditingSessionResult(result.targetId, { value: event.target.value === "" ? null : Number(event.target.value) })}/></label><label><span>Oportunidades</span><input type="number" min="0" disabled={!result.sampled} value={result.opportunities} onChange={(event) => updateEditingSessionResult(result.targetId, { opportunities: Number(event.target.value) })}/></label></>}<label><span>Nota</span><input disabled={!result.sampled} value={result.note} onChange={(event) => updateEditingSessionResult(result.targetId, { note: event.target.value })}/></label><label className="sample-toggle compact"><input type="checkbox" checked={result.sampled} onChange={(event) => updateEditingSessionResult(result.targetId, { sampled: event.target.checked })}/><span>Incluir</span></label></article>; })}</div><div className="modal-actions"><button className="secondary-formation-button" onClick={() => setEditingSession(null)}>Cancelar</button><button className="primary-formation-button" disabled={saving} onClick={saveSessionEdits}>{saving ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>} Guardar cambios</button></div></section></ModalLayer>; })()}
    {deleteProgramTarget && <ModalLayer onDismiss={() => setDeleteProgramTarget(null)} className="modal-backdrop"><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-program-title"><span className="danger-mark"><Trash2 size={23}/></span><h2 id="delete-program-title">Eliminar programa permanentemente</h2><p>Se eliminarán “{deleteProgramTarget.name}”, todos sus targets y todas sus sesiones. Esta acción no se puede deshacer.</p><label><span>Escribe ELIMINAR para confirmar</span><input autoFocus value={deleteText} onChange={(event) => setDeleteText(event.target.value)}/></label><div><button className="secondary-formation-button" onClick={() => setDeleteProgramTarget(null)}>Cancelar</button><button className="danger-button" disabled={deleteText.trim().toUpperCase() !== "ELIMINAR" || saving} onClick={deleteProgram}><Trash2 size={16}/> Eliminar permanentemente</button></div></section></ModalLayer>}
    {deleteSessionTarget && <ModalLayer onDismiss={() => setDeleteSessionTarget(null)} className="modal-backdrop"><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-session-title"><span className="danger-mark"><Trash2 size={23}/></span><h2 id="delete-session-title">Eliminar sesión permanentemente</h2><p>La sesión del {new Date(`${deleteSessionTarget.sessionDate}T12:00:00`).toLocaleDateString("es-NI")} será eliminada y los estados del programa se recalcularán con la evidencia restante.</p><label><span>Escribe ELIMINAR para confirmar</span><input autoFocus value={deleteText} onChange={(event) => setDeleteText(event.target.value)}/></label><div><button className="secondary-formation-button" onClick={() => setDeleteSessionTarget(null)}>Cancelar</button><button className="danger-button" disabled={deleteText.trim().toUpperCase() !== "ELIMINAR" || saving} onClick={deleteSession}><Trash2 size={16}/> Eliminar permanentemente</button></div></section></ModalLayer>}
    {programModal && <ProgramModal form={form} cycles={cycles} profiles={activeProfiles} saving={saving} onChange={setForm} onTargetChange={updateTarget} onCriterionChange={updateCriterion} onAddTarget={addTarget} onRemoveTarget={removeTarget} onClose={() => setProgramModal(false)} onSave={saveProgram}/>} 
  </>;
}

function ProgramModal({
  form,
  cycles,
  profiles,
  saving,
  onChange,
  onTargetChange,
  onCriterionChange,
  onAddTarget,
  onRemoveTarget,
  onClose,
  onSave,
}: {
  form: ProgramForm;
  cycles: CycleOption[];
  profiles: PersonnelProfile[];
  saving: boolean;
  onChange: (form: ProgramForm) => void;
  onTargetChange: (index: number, patch: Partial<TargetDefinition>) => void;
  onCriterionChange: (index: number, stage: CriterionStage, patch: Partial<Criterion>) => void;
  onAddTarget: () => void;
  onRemoveTarget: (index: number) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const selectedProfile = profiles.find((profile) => profile.id === form.profileId);
  const eligibleCycles = cycles.filter((cycle) => !cycle.archivedAt && cycle.profileId === form.profileId);
  const selectedGraphTargetIndex = Math.max(0, form.graphConfig.primaryTargetId
    ? form.targets.findIndex((target) => target.id === form.graphConfig.primaryTargetId)
    : form.graphConfig.primaryTargetIndex || 0);
  return <ModalLayer onDismiss={onClose} className="modal-backdrop program-modal-backdrop"><section className="intervention-program-modal" role="dialog" aria-modal="true" aria-labelledby="program-modal-title"><div className="modal-title sticky-modal-title"><div><p className="section-kicker">Programa de intervención</p><h2 id="program-modal-title">{form.id ? "Editar programa y criterios" : "Crear programa medible"}</h2></div><button aria-label="Cerrar" onClick={onClose}><X size={19}/></button></div><div className="program-modal-body">
    <section className="program-main-fields"><div className="modal-section-heading"><span>1</span><div><strong>Objetivo general</strong><p>Asigna el programa a un niño y define el resultado amplio que organizará sus targets.</p></div></div><div className="program-form-grid"><label><span>Niño</span><select autoFocus value={form.profileId || ""} onChange={(event) => { const profile = profiles.find((item) => item.id === event.target.value); onChange({ ...form, profileId: profile?.id || null, participantName: profile?.fullName || "", site: profile?.site || "León", linkedCycleId: null }); }}>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.fullName} · {profile.site}</option>)}</select>{selectedProfile && <small className="profile-field-note">Sede {selectedProfile.site}</small>}</label><label><span>Vincular evaluación (opcional)</span><select value={form.linkedCycleId || ""} onChange={(event) => onChange({ ...form, linkedCycleId: event.target.value || null })}><option value="">Sin vincular</option>{eligibleCycles.map((cycle) => <option value={cycle.id} key={cycle.id}>{cycle.programContext}</option>)}</select></label><label className="field-wide"><span>Nombre del programa</span><input value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} placeholder="Ej. Comunicación funcional"/></label><label className="field-wide"><span>Objetivo general</span><textarea value={form.objective} onChange={(event) => onChange({ ...form, objective: event.target.value })} placeholder="Describa el resultado global esperado y su relevancia funcional."/></label><label className="field-wide"><span>Instrucciones del programa (opcional)</span><textarea value={form.instructions} onChange={(event) => onChange({ ...form, instructions: event.target.value })} placeholder="Procedimiento, materiales o condiciones relevantes para la sesión."/></label></div></section>
    <section className="program-graph-config"><div className="modal-section-heading"><span>2</span><div><strong>Gráfica principal del programa</strong><p>El expediente abre primero la serie agregada del programa; las gráficas de targets quedan disponibles dentro de ella.</p></div></div><div className="program-form-grid">
      <label><span>Tipo de gráfica</span><select value={form.graphConfig.graphType} onChange={(event) => onChange({ ...form, graphConfig: { ...form.graphConfig, graphType: event.target.value as ProgramGraphType } })}><option value="line">Línea</option><option value="bar">Barras</option><option value="cumulative">Acumulativa de targets masterizados</option></select></label>
      {form.graphConfig.graphType === "line" && <label><span>Diseño o fases</span><select value={form.graphConfig.designType} onChange={(event) => onChange({ ...form, graphConfig: { ...form.graphConfig, designType: event.target.value as ProgramGraphDesign } })}><option value="AB">AB</option><option value="ABA">ABA</option><option value="ABAB">ABAB</option><option value="BAB">BAB</option><option value="multiple-baseline">Línea base múltiple</option><option value="multielement">Multielemento</option><option value="changing-criterion">Criterio cambiante</option><option value="custom">Fases personalizadas</option></select></label>}
      {form.graphConfig.graphType !== "cumulative" && <label><span>Eje Y del programa</span><select value={form.graphConfig.clinicalMetric || "percentage"} onChange={(event) => onChange({ ...form, graphConfig: { ...form.graphConfig, clinicalMetric: event.target.value as ProgramGraphConfig["clinicalMetric"] } })}><option value="percentage">% independientes/correctos</option><option value="count">Respuestas correctas (conteo)</option><option value="opportunities">Oportunidades</option><option value="rate">Ocurrencias por minuto observado</option><option value="mastered">Targets masterizados</option></select></label>}
      <label><span>Agrupar sesiones por</span><select value={form.graphConfig.clinicalGrouping || "session"} onChange={(event) => onChange({ ...form, graphConfig: { ...form.graphConfig, clinicalGrouping: event.target.value as ProgramGraphConfig["clinicalGrouping"] } })}><option value="session">Sesión</option><option value="day">Día</option><option value="week">Semana</option><option value="month">Mes</option></select></label>
      <label><span>Target inicial al abrir la vista secundaria</span><select value={selectedGraphTargetIndex} onChange={(event) => { const index = Number(event.target.value); onChange({ ...form, graphConfig: { ...form.graphConfig, primaryTargetIndex: index, primaryTargetId: form.targets[index]?.id || null } }); }}>{form.targets.map((target, index) => <option value={index} key={target.id || index}>{target.code} · {target.name || `Target ${index + 1}`}</option>)}</select></label>
      <label className="graph-config-toggles"><span>Presentación</span><span><input type="checkbox" checked={form.graphConfig.showPoints} onChange={(event) => onChange({ ...form, graphConfig: { ...form.graphConfig, showPoints: event.target.checked } })}/> Mostrar puntos</span><span><input type="checkbox" checked={form.graphConfig.showLegend} onChange={(event) => onChange({ ...form, graphConfig: { ...form.graphConfig, showLegend: event.target.checked } })}/> Mostrar leyenda</span></label>
    </div></section>
    <section className="program-target-editor"><div className="modal-section-heading"><span>3</span><div><strong>Targets y criterios por estado</strong><p>Cada target funciona como objetivo específico y unidad de medición por sesión.</p></div><button className="secondary-formation-button" onClick={onAddTarget}><Plus size={15}/> Añadir target</button></div>
      <div className="target-editor-stack">{form.targets.map((target, index) => <article className="target-editor-card" key={target.id || `new-${index}`}><header><div><span className={`target-state ${target.state}`}>{stateLabel(target.state)}</span><strong>Target {index + 1}</strong>{target.masteryAchieved && <span className="mastery-badge">Adquirido {target.masteredAt ? `· ${target.masteredAt}` : ""}</span>}</div><button className="icon-danger" disabled={form.targets.length === 1} aria-label={`Eliminar target ${index + 1}`} onClick={() => onRemoveTarget(index)}><Trash2 size={16}/></button></header><div className="target-basic-grid"><label><span>Código</span><input value={target.code} onChange={(event) => onTargetChange(index, { code: event.target.value })}/></label><label><span>Nombre del target</span><input value={target.name} onChange={(event) => onTargetChange(index, { name: event.target.value })} placeholder="Conducta o competencia específica"/></label><label><span>Método de medición</span><select value={target.measurement} onChange={(event) => { const measurement = event.target.value as Measurement; onTargetChange(index, { measurement, unitLabel: unitFor(measurement), criteria: { baseline: defaultCriterion("baseline", measurement), acquisition: defaultCriterion("acquisition", measurement), generalization: defaultCriterion("generalization", measurement), maintenance: defaultCriterion("maintenance", measurement) } }); }}>{(["discrete_trials", "frequency", "duration", "latency", "partial_interval", "task_analysis", "percentage", "occurrence"] as Measurement[]).map((measurement) => <option value={measurement} key={measurement}>{measurementLabel(measurement)}</option>)}</select></label><label><span>Unidad</span><input value={target.unitLabel} onChange={(event) => onTargetChange(index, { unitLabel: event.target.value })}/></label><label className="field-wide"><span>Objetivo específico observable</span><textarea value={target.specificObjective} onChange={(event) => onTargetChange(index, { specificObjective: event.target.value })} placeholder="Qué hará la persona, bajo qué condiciones y con qué desempeño esperado."/></label></div><div className="criteria-grid">{(["baseline", "acquisition", "generalization", "maintenance"] as CriterionStage[]).map((stage) => { const criterion = target.criteria[stage]; return <fieldset key={stage}><legend><span className={`criterion-dot ${stage}`}/>{stateLabel(stage)} <ArrowRight size={13}/> {stageDestination(stage)}</legend>{stage === "baseline" && <p className="baseline-rule">Si cumple, cierra directamente y suma una vez al repertorio; si no, pasa a Adquisición.</p>}{stage === "acquisition" && <p className="baseline-rule mastery-rule">Al cumplir este criterio se registra el dominio una sola vez, aunque después continúe en Masterizado y Generalizado.</p>}<div><label><span>Métrica</span><select value={criterion.metric} onChange={(event) => onCriterionChange(index, stage, { metric: event.target.value as Criterion["metric"] })}><option value="percentage_correct">% respuestas correctas</option><option value="correct_count">Cantidad correctas</option><option value="value">Valor de la medición</option></select></label><label><span>Operador</span><select value={criterion.operator} onChange={(event) => onCriterionChange(index, stage, { operator: event.target.value as "gte" | "lte" })}><option value="gte">Mayor o igual (≥)</option><option value="lte">Menor o igual (≤)</option></select></label><label><span>Umbral</span><input type="number" step="any" value={criterion.threshold} onChange={(event) => onCriterionChange(index, stage, { threshold: Number(event.target.value) })}/></label><label><span>Mínimo de ensayos</span><input type="number" min="0" value={criterion.minTrials} onChange={(event) => onCriterionChange(index, stage, { minTrials: Number(event.target.value) })}/></label><label><span>Sesiones requeridas</span><input type="number" min="1" value={criterion.requiredSessions} onChange={(event) => onCriterionChange(index, stage, { requiredSessions: Number(event.target.value) })}/></label><label><span>Contextos distintos</span><input type="number" min="1" value={criterion.distinctContexts} onChange={(event) => onCriterionChange(index, stage, { distinctContexts: Number(event.target.value) })}/></label><label className="criterion-checkbox"><input type="checkbox" checked={criterion.consecutive} onChange={(event) => onCriterionChange(index, stage, { consecutive: event.target.checked })}/><span>Exigir sesiones consecutivas</span></label><label className="criterion-checkbox"><input type="checkbox" checked={criterion.insufficientSampleBreaksStreak} onChange={(event) => onCriterionChange(index, stage, { insufficientSampleBreaksStreak: event.target.checked })}/><span>Una muestra insuficiente reinicia la secuencia</span></label></div></fieldset>; })}</div></article>)}</div>
    </section>
    <section className="program-session-config"><div className="modal-section-heading"><span>4</span><div><strong>Configuración de la toma real</strong><p>Define lo que la terapeuta verá y registrará durante la sesión.</p></div></div>
      <div className="session-config-stack">{form.targets.map((target, index) => <article key={target.id || `session-config-${index}`}><header><span className={`target-state ${target.state}`}>{stateLabel(target.state)}</span><strong>{target.code} · {target.name || `Target ${index + 1}`}</strong></header><div className="program-form-grid">
        <label><span>Tipo de registro</span><select value={target.measurement} onChange={(event) => { const measurement = event.target.value as Measurement; onTargetChange(index, { measurement, unitLabel: unitFor(measurement), criteria: { baseline: defaultCriterion("baseline", measurement), acquisition: defaultCriterion("acquisition", measurement), generalization: defaultCriterion("generalization", measurement), maintenance: defaultCriterion("maintenance", measurement) } }); }}>{(["discrete_trials", "frequency", "duration", "latency", "partial_interval", "task_analysis", "percentage", "occurrence"] as Measurement[]).map((measurement) => <option value={measurement} key={measurement}>{measurementLabel(measurement)}</option>)}</select></label>
        <label><span>Sonda de mantenimiento cada</span><select value={target.sessionConfig?.maintenanceProbeEveryDays || 7} onChange={(event) => onTargetChange(index, { sessionConfig: { ...target.sessionConfig, maintenanceProbeEveryDays: Number(event.target.value) } })}>{[1,3,7,14,21,30].map((days) => <option value={days} key={days}>{days} día{days === 1 ? "" : "s"}</option>)}</select></label>
        <label className="field-wide"><span>SD / instrucción antecedente</span><textarea value={target.sessionConfig?.discriminativeStimulus || ""} onChange={(event) => onTargetChange(index, { sessionConfig: { ...target.sessionConfig, discriminativeStimulus: event.target.value } })} placeholder="La instrucción exacta o condición que antecede la respuesta."/></label>
        <label className="field-wide"><span>Cómo enseñar</span><textarea value={target.sessionConfig?.teachingInstructions || ""} onChange={(event) => onTargetChange(index, { sessionConfig: { ...target.sessionConfig, teachingInstructions: event.target.value } })} placeholder="Procedimiento, corrección de error y reforzamiento del target."/></label>
        {target.measurement === "partial_interval" && <label><span>Duración del intervalo</span><select value={target.sessionConfig?.intervalSeconds || 30} onChange={(event) => onTargetChange(index, { sessionConfig: { ...target.sessionConfig, intervalSeconds: Number(event.target.value) as 10 | 30 | 60 } })}><option value={10}>10 segundos</option><option value={30}>30 segundos</option><option value={60}>60 segundos</option></select></label>}
        {target.measurement === "task_analysis" && <label className="field-wide"><span>Pasos de la cadena · uno por línea</span><textarea value={(target.sessionConfig?.taskSteps || []).join("\n")} onChange={(event) => onTargetChange(index, { sessionConfig: { ...target.sessionConfig, taskSteps: event.target.value.split("\n").map((step) => step.trim()).filter(Boolean) } })} placeholder={"1. Primer paso\n2. Segundo paso\n3. Tercer paso"}/></label>}
      </div></article>)}</div>
    </section>
  </div><div className="program-modal-footer"><div><BarChart3 size={17}/><span>Los datos se registran una sola vez durante la sesión y alimentan automáticamente la gráfica del programa.</span></div><div><button className="secondary-formation-button" onClick={onClose}>Cancelar</button><button className="primary-formation-button" disabled={saving} onClick={onSave}>{saving ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>} {form.id ? "Guardar cambios" : "Crear programa"}</button></div></div></section></ModalLayer>;
}
