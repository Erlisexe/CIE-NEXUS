import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { randomUUID } from "expo-crypto";
import {
  evaluateResult,
  targetStateLabel,
  type CriterionStage,
  type TargetState,
  type TrialResponseCode,
} from "../../../lib/clinical-mastery.ts";
import {
  PREFLIGHT_ITEMS,
  activeObservations,
  capturedResult,
  closeCollectionDraft,
  collectionDateTime,
  createCollectionDraft,
  isDiscrete,
  isDuplicateTrialTap,
  reviewCollectionConfiguration,
  stopCollectionClocks,
  targetDefinition,
  type CollectionAbc,
  type CollectionDraft,
  type CollectionPreparation,
  type CollectionTarget,
  type SessionPreflight,
  type SessionSignature,
  type SignaturePoint,
  type TargetCapture,
} from "../../../lib/mobile-collection.ts";
import type { Appointment, Bootstrap } from "../types";
import { mobileGet, MobileApiError } from "../lib/api";
import { colors } from "../theme";
import type { CollectionController } from "./useCollection";
import { SignaturePad } from "./SignaturePad";

type Props = {
  controller: CollectionController;
  bootstrap: Bootstrap;
  appointments: Appointment[];
  accessToken: string;
  profileId: string | null;
  onBack: () => void;
};
type Panel = "note" | "abc" | "review" | null;
type SessionView = "take" | "sheet";
type IntervalState = { targetId: string; endsAt: number } | null;
type SessionTarget = CollectionTarget & {
  programId: string;
  programName: string;
  programObjective: string;
  programInstructions: string;
};

const CONTEXTS = ["Mesa", "Piso", "Patio", "Baño", "Comedor", "Comunidad", "Otro"] as const;
const RESPONSES: Array<{ code: TrialResponseCode; label: string }> = [
  { code: "I", label: "Independiente" },
  { code: "G", label: "Gestual" },
  { code: "V", label: "Verbal" },
  { code: "M", label: "Modelado" },
  { code: "FP", label: "Física parcial" },
  { code: "FT", label: "Física total" },
  { code: "X", label: "Incorrecto" },
];

const dateParts = collectionDateTime;
const clock = (seconds: number) => {
  const value = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value / 60) % 60;
  const rest = value % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
};
const phase = (value: string) => ["baseline", "acquisition", "generalization", "maintenance", "closed"].includes(value)
  ? targetStateLabel(value as TargetState)
  : value;
const measurement = (value: string) => ({
  percentage: "Ensayos",
  occurrence: "Ensayos discretos",
  discrete_trials: "Ensayos discretos",
  frequency: "Frecuencia",
  duration: "Duración",
  latency: "Latencia",
  partial_interval: "Intervalo parcial",
  task_analysis: "Análisis de tarea",
} as Record<string, string>)[value] || value;
const responseLabel = (value?: TrialResponseCode | null) => RESPONSES.find((item) => item.code === value)?.label || "Sin registro previo";

function Button({ children, onPress, quiet = false, danger = false, disabled = false, compact = false }: {
  children: ReactNode;
  onPress: () => void;
  quiet?: boolean;
  danger?: boolean;
  disabled?: boolean;
  compact?: boolean;
}) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [
    s.button,
    quiet && s.quiet,
    danger && s.danger,
    compact && s.compactButton,
    disabled && s.disabled,
    pressed && !disabled && s.pressed,
  ]}><Text style={[s.buttonText, quiet && s.quietText]}>{children}</Text></Pressable>;
}

function Field({ label, value, onChange, guidance, multiline = true, max = 12000, placeholder }: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  guidance?: string;
  multiline?: boolean;
  max?: number;
  placeholder?: string;
}) {
  return <View style={s.field}>
    <Text style={s.label}>{label}</Text>
    {guidance ? <Text style={s.meta}>{guidance}</Text> : null}
    <TextInput
      accessibilityLabel={label}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      multiline={multiline}
      maxLength={max}
      textAlignVertical="top"
      style={[s.input, multiline && s.multiline]}
    />
  </View>;
}

function CheckRow({ checked, label, onPress, disabled = false }: { checked: boolean; label: string; onPress: () => void; disabled?: boolean }) {
  return <Pressable
    accessibilityRole="checkbox"
    accessibilityState={{ checked, disabled }}
    disabled={disabled}
    onPress={onPress}
    style={[s.checkRow, checked && s.checkRowSelected, disabled && s.disabled]}
  ><Text style={s.checkMark}>{checked ? "✓" : "○"}</Text><Text style={[s.body, s.flex]}>{label}</Text></Pressable>;
}

function blankCapture(target: CollectionTarget): TargetCapture {
  return {
    targetId: target.id,
    definition: targetDefinition(target),
    observations: [],
    note: "",
    opportunities: 0,
    timerStartedAt: null,
    frequencyObservationStartedAt: null,
    frequencyObservationElapsedMs: 0,
  };
}

function hasDraftData(draft: CollectionDraft) {
  return Object.values(draft.captures).some((capture) =>
    activeObservations(capture).length > 0
    || Boolean(capture.timerStartedAt)
    || Boolean(capture.frequencyObservationStartedAt)
    || (capture.frequencyObservationElapsedMs || 0) > 0
    || Boolean(capture.note.trim()))
    || draft.abc.length > 0
    || Object.values(draft.noteValues).some((value) => Boolean(value.trim()))
    || Boolean(draft.closing && (
      draft.closing.activities.trim()
      || draft.closing.incidents.trim()
      || draft.closing.guardianName.trim()
      || draft.closing.concernNote.trim()
      || draft.closing.coordinatorName.trim()
    ));
}

function targetStatus(target: CollectionTarget, capture?: TargetCapture) {
  const result = capturedResult(target, capture);
  const stage = (target.state === "closed" ? "maintenance" : target.state) as CriterionStage;
  const criterion = target.criteria[stage];
  const evaluation = evaluateResult(result, criterion);
  return { result, criterion, evaluation, minimumMet: result.sampled && result.opportunities >= criterion.minTrials };
}

function resultText(target: CollectionTarget, capture?: TargetCapture) {
  const result = capturedResult(target, capture);
  if (!result.sampled || result.value === null) return "Sin dato";
  if (isDiscrete(target.measurement)) return `${result.correct || 0}/${result.opportunities} · ${result.value}%`;
  if (target.measurement === "frequency") return `${result.value} ocurrencias${result.ratePerMinute !== null && result.ratePerMinute !== undefined ? ` · ${result.ratePerMinute}/min` : ""}`;
  return `${clock(result.value)} acumulado`;
}

function summaryLabel(target: CollectionTarget, capture?: TargetCapture) {
  const status = targetStatus(target, capture);
  if (!status.result.sampled) return "Sin dato";
  if (status.evaluation.status === "met") return "Cumple";
  if (status.evaluation.status === "not_met") return "No cumple";
  if (status.evaluation.status === "insufficient_sample") return "Muestra corta";
  return "Sin dato";
}

function SheetTargetCard({ item, capture, enabled, wide, onOpen, onTrial, onFrequency }: {
  item: SessionTarget;
  capture?: TargetCapture;
  enabled: boolean;
  wide: boolean;
  onOpen: (id: string) => void;
  onTrial: (target: SessionTarget, code: TrialResponseCode) => void;
  onFrequency: (target: SessionTarget, amount: number) => void;
}) {
  const itemCapture = capture || blankCapture(item);
  const itemStatus = targetStatus(item, itemCapture);
  const itemLast = activeObservations(itemCapture).at(-1)?.responseCode || item.lastPromptCode;
  const itemProbe = item.state === "baseline" || item.state === "maintenance";
  const quick: TrialResponseCode[] = itemProbe ? ["I", "X"] : ["I", "G", "V", "X"];
  return <View style={[s.sheetCard, wide && s.sheetCardWide, itemStatus.minimumMet && (itemStatus.evaluation.status === "met" ? s.sampleMet : s.sampleReady)]}>
    <Pressable onPress={() => onOpen(item.id)} style={s.stack}>
      <View style={s.row}><Text style={s.phase}>{phase(item.state)}</Text><Text style={[s.meta, s.flex]}>{item.programName}</Text></View>
      <Text style={s.heading}>{item.code} · {item.name}</Text>
      <Text style={s.meta}>Última ayuda: {responseLabel(itemLast)}</Text>
      <Text style={s.resultLine}>{resultText(item, itemCapture)}</Text>
    </Pressable>
    <View style={s.quickRow}>{isDiscrete(item.measurement) && item.measurement !== "partial_interval" ? quick.map((code) => <Pressable key={code} disabled={!enabled} onPress={() => onTrial(item, code)} style={[s.quickKey, code === "I" ? s.quickIndependent : code === "X" ? s.quickIncorrect : s.quickPrompt, !enabled && s.disabled]}><Text style={s.quickKeyText}>{code}</Text></Pressable>) : item.measurement === "frequency" ? <><Button compact disabled={!enabled} onPress={() => onFrequency(item, 1)}>+1</Button><Button compact disabled={!enabled} onPress={() => onFrequency(item, 5)}>+5</Button><Button compact quiet onPress={() => onOpen(item.id)}>Reloj</Button></> : <Button compact quiet onPress={() => onOpen(item.id)}>Abrir toma</Button>}</View>
  </View>;
}

export function CollectionWorkspace({ controller, bootstrap, appointments, accessToken, profileId, onBack }: Props) {
  const { drafts, vault, save, discard, synchronize, storageError, syncing } = controller;
  const { width } = useWindowDimensions();
  const [selectedId, setSelectedId] = useState<string | null>(() => drafts.find((item) => item.status === "active" && (!profileId || item.preparation.profile.id === profileId))?.id || null);
  const [preparation, setPreparation] = useState<CollectionPreparation | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [offlinePrep, setOfflinePrep] = useState(false);
  const [contextCategory, setContextCategory] = useState("");
  const [contextOther, setContextOther] = useState("");
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [checks, setChecks] = useState({ identity: false, programs: false, materials: false });
  const [focusedTargetId, setFocusedTargetId] = useState("");
  const [view, setView] = useState<SessionView>("take");
  const [panel, setPanel] = useState<Panel>(null);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [probePromptsOpen, setProbePromptsOpen] = useState(false);
  const [intervalState, setIntervalState] = useState<IntervalState>(null);
  const [signatureStrokes, setSignatureStrokes] = useState<SignaturePoint[][]>([]);
  const [coordinatorStrokes, setCoordinatorStrokes] = useState<SignaturePoint[][]>([]);
  const [attested, setAttested] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [abcForm, setAbcForm] = useState({ antecedent: "", behavior: "", consequence: "", intensity: 3, activity: "", note: "" });
  const [now, setNow] = useState(0);
  const [lastTrialTap, setLastTrialTap] = useState<{ targetId: string; at: number } | null>(null);

  const draft = drafts.find((item) => item.id === selectedId) || null;
  const currentRef = useRef<CollectionDraft | null>(null);
  const saveRef = useRef(save);
  const discardRef = useRef(discard);
  const backRef = useRef(onBack);
  const leaveRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    currentRef.current = draft;
    saveRef.current = save;
    discardRef.current = discard;
    backRef.current = onBack;
  }, [discard, draft, onBack, save]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    const heartbeat = setInterval(() => {
      const current = currentRef.current;
      if (current?.status === "active" && AppState.currentState === "active") {
        try { saveRef.current({ ...current, lastActiveAt: new Date().toISOString() }); } catch {}
      }
    }, 5000);
    const appState = AppState.addEventListener("change", (state) => {
      const current = currentRef.current;
      if (state !== "active" && current?.status === "active") {
        try {
          const stopped = stopCollectionClocks(current, new Date().toISOString(), randomUUID);
          saveRef.current(stopped);
          currentRef.current = stopped;
          setIntervalState(null);
        } catch {}
      }
    });
    const hardwareBack = BackHandler.addEventListener("hardwareBackPress", () => {
      leaveRef.current();
      return true;
    });
    return () => {
      clearInterval(timer);
      clearInterval(heartbeat);
      appState.remove();
      hardwareBack.remove();
    };
  }, []);

  function selectDraft(id: string | null) {
    setSelectedId(id);
    setFocusedTargetId("");
    setView("take");
    setPanel(null);
    setIntervalState(null);
    setSignatureStrokes([]);
    setCoordinatorStrokes([]);
    setAttested(false);
    setChecks({ identity: false, programs: false, materials: false });
  }

  function commit(change: (current: CollectionDraft) => CollectionDraft) {
    const current = currentRef.current;
    if (!current) return;
    try {
      const next = { ...change(current), signature: undefined };
      save(next);
      currentRef.current = next;
      setSignatureStrokes([]);
      setCoordinatorStrokes([]);
      setAttested(false);
    } catch (error) {
      Alert.alert("No se guardó el cambio", error instanceof Error ? error.message : "No cierres la sesión y vuelve a intentar.");
    }
  }

  function resetPreparation(ready: CollectionPreparation, offline: boolean) {
    const eligible = ready.programs.flatMap((program) => program.targets)
      .filter((target) => target.state !== "maintenance" || target.maintenanceDue !== false)
      .map((target) => target.id);
    setPreparation(ready);
    setOfflinePrep(offline);
    setContextCategory("");
    setContextOther("");
    setSelectedTargets(eligible);
    setTemplateId(ready.templates[0]?.id || "");
    setChecks({ identity: false, programs: false, materials: false });
  }

  async function prepare(profile: string, appointmentId: string | null) {
    if (!vault) return;
    setPreparing(true);
    const key = `collection:${appointmentId || profile}`;
    try {
      const ready = await mobileGet<CollectionPreparation>(`/collection?profileId=${encodeURIComponent(profile)}${appointmentId ? `&appointmentId=${encodeURIComponent(appointmentId)}` : ""}`, accessToken);
      vault.cache(key, ready);
      resetPreparation(ready, false);
    } catch (error) {
      const cached = vault.cached<CollectionPreparation>(key);
      const transient = error instanceof MobileApiError && (!error.status || error.status >= 500);
      if (cached && transient && cached.professionalAccountId === bootstrap.account.id) resetPreparation(cached, true);
      else Alert.alert("No se pudo preparar", error instanceof Error ? error.message : "Abre esta cita con conexión para descargar programas y plantillas.");
    } finally {
      setPreparing(false);
    }
  }

  function toggleTarget(target: CollectionTarget) {
    if (target.state === "maintenance" && target.maintenanceDue === false) return;
    setSelectedTargets((current) => current.includes(target.id) ? current.filter((id) => id !== target.id) : [...current, target.id]);
  }

  function begin() {
    if (!preparation) return;
    const activeDraft = drafts.find((item) => item.status === "active");
    if (activeDraft) {
      if (activeDraft.preparation.profile.id !== preparation.profile.id) {
        Alert.alert("Hay otra sesión abierta", `La sesión abierta corresponde a ${activeDraft.preparation.profile.fullName}. Ciérrala antes de iniciar otra terapia.`, [
          { text: "Volver", style: "cancel" },
          { text: "Revisar sesión abierta", onPress: () => { selectDraft(activeDraft.id); setPreparation(null); } },
        ]);
      } else {
        selectDraft(activeDraft.id);
        setPreparation(null);
      }
      return;
    }
    const duplicate = drafts.find((item) => preparation.appointment && item.preparation.appointment?.id === preparation.appointment.id);
    if (duplicate) {
      selectDraft(duplicate.id);
      setPreparation(null);
      return;
    }
    if (preparation.appointment && preparation.appointment.sessionDate !== dateParts(new Date()).date) {
      Alert.alert("Revisa la fecha de la cita", "Puedes preparar otras fechas, pero debes iniciar la terapia el día de su cita en Nicaragua.");
      return;
    }
    if (!selectedTargets.length) {
      Alert.alert("Selecciona targets", "Elige al menos un target para la sesión de hoy.");
      return;
    }
    if (!contextCategory || (contextCategory === "Otro" && !contextOther.trim())) {
      Alert.alert("Selecciona el contexto", "Indica dónde se realizará la toma.");
      return;
    }
    if (!PREFLIGHT_ITEMS.every((item) => checks[item.id])) {
      Alert.alert("Checklist previo", "Completa las tres verificaciones antes de iniciar.");
      return;
    }
    const allowed = new Set(selectedTargets);
    const selectedPreparation: CollectionPreparation = {
      ...preparation,
      programs: preparation.programs
        .map((program) => ({ ...program, targets: program.targets.filter((target) => allowed.has(target.id) && (target.state !== "maintenance" || target.maintenanceDue !== false)) }))
        .filter((program) => program.targets.length > 0),
      templates: [
        ...preparation.templates.filter((template) => template.id === templateId),
        ...preparation.templates.filter((template) => template.id !== templateId),
      ],
    };
    try {
      const at = new Date().toISOString();
      const next = createCollectionDraft(selectedPreparation, randomUUID(), at);
      next.context = contextCategory === "Otro" ? contextOther.trim() : contextCategory;
      next.preflight = {
        version: 1,
        accountId: bootstrap.account.id,
        profileId: selectedPreparation.profile.id,
        checkedAt: at,
        timing: "before_start",
        checks: { ...checks },
      };
      save(next);
      selectDraft(next.id);
      setPreparation(null);
    } catch (error) {
      Alert.alert("No se pudo iniciar", error instanceof Error ? error.message : "Revisa el guardado local.");
    }
  }

  function discardEmptyAndLeave() {
    const current = currentRef.current;
    if (!current || hasDraftData(current)) return;
    try {
      discardRef.current(current.id);
      currentRef.current = null;
      backRef.current();
    } catch (error) {
      Alert.alert("No se pudo descartar", error instanceof Error ? error.message : "El borrador permanece guardado.");
    }
  }

  function requestLeave() {
    const current = currentRef.current;
    if (!current || current.status !== "active") {
      backRef.current();
      return;
    }
    if (hasDraftData(current)) {
      Alert.alert(
        "Esta sesión ya tiene datos",
        "El borrador está guardado. Para salir debes cerrar y firmar la sesión; no se perderá lo tomado.",
        [
          { text: "Continuar tomando", style: "cancel" },
          { text: "Ir al cierre", onPress: () => setPanel("review") },
        ],
      );
      return;
    }
    Alert.alert("Descartar sesión vacía", "Todavía no hay datos clínicos. Puedes descartar este borrador sin afectar la cita.", [
      { text: "Continuar", style: "cancel" },
      { text: "Descartar", style: "destructive", onPress: discardEmptyAndLeave },
    ]);
  }
  useEffect(() => {
    leaveRef.current = requestLeave;
  });

  async function refreshConflict() {
    if (!draft) return;
    setPreparing(true);
    try {
      const old = draft.preparation;
      const fresh = await mobileGet<CollectionPreparation>(`/collection?profileId=${encodeURIComponent(old.profile.id)}${old.appointment ? `&appointmentId=${encodeURIComponent(old.appointment.id)}` : ""}`, accessToken);
      reviewCollectionConfiguration(draft, fresh);
      Alert.alert("Revisar la configuración vigente", "Se conservan los registros, la duración y la fecha del cierre. Revisa la nota y vuelve a firmar para aplicar los criterios actuales.", [
        { text: "Volver", style: "cancel" },
        { text: "Revisar", onPress: () => { commit((current) => reviewCollectionConfiguration(current, fresh)); setPanel("note"); } },
      ]);
    } catch (error) {
      Alert.alert("Revisión necesaria", error instanceof Error ? error.message : "Los datos se conservan.");
    } finally {
      setPreparing(false);
    }
  }

  if (!draft) {
    const acquisitionCount = preparation?.programs.flatMap((program) => program.targets).filter((target) => target.state === "acquisition" && selectedTargets.includes(target.id)).length || 0;
    const alerts = preparation?.profile.clinicalAlerts;
    return <SafeAreaView style={s.safe} edges={["top", "bottom"]}><ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
      <Button quiet onPress={onBack}>‹ Volver</Button>
      <Text style={s.title}>Sesiones</Text>
      <Text style={s.meta}>Prepara la cita con conexión; después la toma y el cierre quedan protegidos en el teléfono hasta sincronizar.</Text>
      {storageError ? <Text style={s.error}>{storageError}</Text> : null}
      {drafts.filter((item) => !profileId || item.preparation.profile.id === profileId).slice().reverse().map((item) => <View key={item.id} style={s.card}>
        <Text style={s.heading}>{item.preparation.profile.fullName}</Text>
        <Text style={s.meta}>{item.preparation.appointment?.sessionDate || item.startedAt.slice(0, 10)} · {item.status === "active" ? "Guardada en el teléfono · En pausa" : item.status === "pending" ? "Pendiente de sincronización" : item.status === "conflict" ? "Requiere revisión" : "Sincronizada"}</Text>
        <Button quiet onPress={() => selectDraft(item.id)}>{item.status === "active" ? "Continuar sesión" : "Ver sesión"}</Button>
      </View>)}
      {preparation ? <View style={s.stack}>
        <View style={s.card}>
          <Text style={s.title}>{preparation.profile.fullName}</Text>
          <Text style={s.meta}>{offlinePrep ? "Preparación guardada en el teléfono" : "Preparación actualizada"} · {new Date(preparation.preparedAt).toLocaleString("es-NI")}</Text>
          {preparation.appointment?.notes ? <Text style={s.body}>{preparation.appointment.notes}</Text> : null}
        </View>
        <View style={s.alertGrid}>
          <View style={[s.alertCard, Boolean(alerts?.allergies) && s.alertWarning]}><Text style={s.miniLabel}>Alergias</Text><Text style={s.alertValue}>{alerts?.allergies || "No registradas"}</Text></View>
          <View style={s.alertCard}><Text style={s.miniLabel}>Medicamentos</Text><Text style={s.alertValue}>{alerts?.medications || "No registrados"}</Text></View>
          <View style={[s.alertCard, s.alertSuccess]}><Text style={s.miniLabel}>Refuerzos / preferencias</Text><Text style={s.alertValue}>{alerts?.reinforcers || "No registrados"}</Text></View>
        </View>
        <View style={s.card}>
          <Text style={s.heading}>Contexto de hoy</Text>
          <Text style={s.meta}>Selecciona el lugar principal de la toma.</Text>
          <View style={s.choiceGrid}>{CONTEXTS.map((context) => <Pressable key={context} accessibilityRole="radio" accessibilityState={{ selected: contextCategory === context }} onPress={() => setContextCategory(context)} style={[s.choice, contextCategory === context && s.choiceSelected]}><Text style={[s.choiceText, contextCategory === context && s.choiceTextSelected]}>{context}</Text></Pressable>)}</View>
          {contextCategory === "Otro" ? <Field label="Describe el contexto *" value={contextOther} onChange={setContextOther} multiline={false} max={1000} /> : null}
        </View>
        <View style={s.card}>
          <View style={s.row}><View style={s.flex}><Text style={s.heading}>Targets que se tomarán hoy</Text><Text style={s.meta}>{selectedTargets.length} seleccionados</Text></View>{acquisitionCount > 5 ? <Text style={s.warning}>⚠ {acquisitionCount} en adquisición</Text> : null}</View>
          {acquisitionCount > 5 ? <Text style={s.warningBox}>Hay más de 5 targets en adquisición. Revisa si la carga de enseñanza es viable para esta sesión.</Text> : null}
          {preparation.programs.map((program) => <View key={program.id} style={s.programGroup}><Text style={s.heading}>{program.name}</Text>{program.targets.map((target) => {
            const unavailable = target.state === "maintenance" && target.maintenanceDue === false;
            return <CheckRow key={target.id} checked={selectedTargets.includes(target.id)} disabled={unavailable} onPress={() => toggleTarget(target)} label={`${target.code} · ${target.name}\n${phase(target.state)} · ${measurement(target.measurement)} · última ayuda: ${responseLabel(target.lastPromptCode)}${unavailable ? `\nSonda disponible ${target.maintenanceDueDate || "según programación"}` : ""}`} />;
          })}</View>)}
        </View>
        <View style={s.card}>
          <Text style={s.heading}>Plantilla de nota</Text>
          <View style={s.choiceGrid}>{preparation.templates.map((template) => <Pressable key={template.id || template.name} onPress={() => setTemplateId(template.id || "")} style={[s.choice, templateId === (template.id || "") && s.choiceSelected]}><Text style={[s.choiceText, templateId === (template.id || "") && s.choiceTextSelected]}>{template.name}</Text></Pressable>)}</View>
          <Text style={s.heading}>Checklist previo</Text>
          {PREFLIGHT_ITEMS.map((item) => <CheckRow key={item.id} checked={checks[item.id]} onPress={() => setChecks((current) => ({ ...current, [item.id]: !current[item.id] }))} label={item.label} />)}
          <Button disabled={!selectedTargets.length || !contextCategory || (contextCategory === "Otro" && !contextOther.trim()) || !PREFLIGHT_ITEMS.every((item) => checks[item.id])} onPress={begin}>Iniciar sesión</Button>
          <Button quiet onPress={() => setPreparation(null)}>Volver a la agenda</Button>
        </View>
      </View> : <>
        {appointments.filter((appointment) => appointment.canStart && (!profileId || appointment.profileId === profileId)).map((appointment) => <View key={appointment.id} style={s.card}>
          <Text style={s.heading}>{appointment.profileName}</Text>
          <Text style={s.body}>{appointment.sessionDate} · {appointment.startTime.slice(0, 5)}–{appointment.endTime.slice(0, 5)}</Text>
          <Text style={s.meta}>{appointment.site} · {appointment.sessionType}</Text>
          <Button disabled={preparing || !vault} onPress={() => void prepare(appointment.profileId, appointment.id)}>Preparar sesión</Button>
        </View>)}
        {profileId && bootstrap.account.role !== "terapeuta" ? <Button disabled={preparing || !vault} onPress={() => void prepare(profileId, null)}>Sesión del niño sin cita</Button> : null}
        {!appointments.some((appointment) => appointment.canStart && (!profileId || appointment.profileId === profileId)) ? <Text style={s.meta}>No hay citas disponibles. Las sesiones del terapeuta se inician desde una cita asignada.</Text> : null}
      </>}
      {preparing ? <ActivityIndicator size="large" color={colors.primary} /> : null}
      <Button quiet disabled={syncing} onPress={() => void synchronize()}>{syncing ? "Sincronizando…" : "Sincronizar pendientes"}</Button>
    </ScrollView></SafeAreaView>;
  }

  const sessionDraft: CollectionDraft = draft;

  const targets: SessionTarget[] = draft.preparation.programs.flatMap((program) => program.targets.map((target) => ({
    ...target,
    programId: program.id,
    programName: program.name,
    programObjective: program.objective,
    programInstructions: program.instructions,
  })));
  const focusedIndex = Math.max(0, targets.findIndex((target) => target.id === focusedTargetId));
  const target = targets[focusedIndex] || targets[0]!;
  const capture = draft.captures[target.id] || blankCapture(target);
  const observations = activeObservations(capture);
  const status = targetStatus(target, capture);
  const working = draft.status === "active";
  const reviewable = working || (draft.status === "conflict" && draft.syncErrorCode === "session_review_required");
  const enabled = working && Boolean(draft.runningSince) && !storageError;
  const elapsed = (draft.elapsedMs + (draft.runningSince ? Math.max(0, now - Date.parse(draft.runningSince)) : 0)) / 1000;
  const probe = target.state === "baseline" || target.state === "maintenance";
  const lastResponse = observations.at(-1)?.responseCode;
  const steps = target.sessionConfig.taskSteps.length ? target.sessionConfig.taskSteps : [target.specificObjective || target.name];
  const taskStepIndex = observations.length % steps.length;
  const measuredSeconds = observations.reduce((sum, item) => sum + item.value, 0) + (capture.timerStartedAt ? Math.max(0, Math.floor((now - Date.parse(capture.timerStartedAt)) / 1000)) : 0);
  const frequencyObservationMs = (capture.frequencyObservationElapsedMs || 0) + (capture.frequencyObservationStartedAt ? Math.max(0, now - Date.parse(capture.frequencyObservationStartedAt)) : 0);
  const frequencyCount = observations.reduce((sum, item) => sum + item.value, 0);
  const rate = frequencyObservationMs > 0 ? Math.round((frequencyCount / frequencyObservationMs) * 600000) / 10 : null;
  const intervalExpired = Boolean(intervalState && now >= intervalState.endsAt);
  const dataPresent = hasDraftData(draft);

  function selectTarget(id: string) {
    setFocusedTargetId(id);
    setView("take");
    setInstructionsOpen(false);
    setProbePromptsOpen(false);
    setIntervalState(null);
  }

  function changeCapture(forTarget: SessionTarget, change: (current: TargetCapture) => TargetCapture) {
    if (!enabled) return;
    commit((current) => {
      const initial = current.captures[forTarget.id] || blankCapture(forTarget);
      return { ...current, captures: { ...current.captures, [forTarget.id]: change(initial) } };
    });
  }

  function recordTrial(forTarget: SessionTarget, code: TrialResponseCode) {
    if (!enabled) return;
    const tap = new Date().getTime();
    if (isDuplicateTrialTap(lastTrialTap, forTarget.id, tap)) return;
    setLastTrialTap({ targetId: forTarget.id, at: tap });
    const targetSteps = forTarget.sessionConfig.taskSteps.length ? forTarget.sessionConfig.taskSteps : [forTarget.specificObjective || forTarget.name];
    const active = activeObservations(sessionDraft.captures[forTarget.id] || blankCapture(forTarget));
    const stepIndex = forTarget.measurement === "task_analysis" ? active.length % targetSteps.length : undefined;
    const isProbe = forTarget.state === "baseline" || forTarget.state === "maintenance";
    changeCapture(forTarget, (current) => ({
      ...current,
      opportunities: current.opportunities + 1,
      observations: [...current.observations, {
        id: randomUUID(),
        at: new Date().toISOString(),
        value: code === "I" ? 1 : 0,
        responseCode: code,
        ...(stepIndex !== undefined ? { taskStepIndex: stepIndex, taskStep: targetSteps[stepIndex] } : {}),
        ...(isProbe ? { probe: true } : {}),
      }],
    }));
  }

  function undo(forTarget = target) {
    const current = sessionDraft.captures[forTarget.id] || blankCapture(forTarget);
    const last = activeObservations(current).at(-1);
    if (!last) return;
    const at = new Date().toISOString();
    changeCapture(forTarget, (value) => ({
      ...value,
      opportunities: Math.max(0, value.opportunities - 1),
      observations: value.observations.map((item) => item.id === last.id ? { ...item, removedAt: at } : item),
    }));
  }

  function adjustFrequency(forTarget: SessionTarget, amount: number) {
    if (!enabled) return;
    const at = new Date().toISOString();
    changeCapture(forTarget, (current) => ({
      ...current,
      opportunities: Math.max(1, current.opportunities),
      frequencyObservationStartedAt: current.frequencyObservationStartedAt || at,
      observations: [...current.observations, { id: randomUUID(), at, value: amount }],
    }));
  }

  function toggleFrequencyObservation() {
    if (!enabled) return;
    const at = new Date().toISOString();
    const time = Date.parse(at);
    changeCapture(target, (current) => current.frequencyObservationStartedAt
      ? {
        ...current,
        frequencyObservationStartedAt: null,
        opportunities: Math.max(1, current.opportunities),
        frequencyObservationElapsedMs: (current.frequencyObservationElapsedMs || 0) + Math.max(0, time - Date.parse(current.frequencyObservationStartedAt)),
      }
      : { ...current, frequencyObservationStartedAt: at });
  }

  function toggleMeasurementTimer() {
    if (!enabled) return;
    const at = new Date().toISOString();
    const time = Date.parse(at);
    changeCapture(target, (current) => current.timerStartedAt
      ? {
        ...current,
        timerStartedAt: null,
        opportunities: current.opportunities + 1,
        observations: [...current.observations, { id: randomUUID(), at, value: Math.max(0, Math.round((time - Date.parse(current.timerStartedAt)) / 1000)) }],
      }
      : { ...current, timerStartedAt: at });
  }

  function togglePause() {
    const at = new Date().toISOString();
    setIntervalState(null);
    commit((current) => current.runningSince ? stopCollectionClocks(current, at, randomUUID) : { ...current, runningSince: at });
  }

  function startInterval() {
    if (!enabled) return;
    setIntervalState({ targetId: target.id, endsAt: new Date().getTime() + target.sessionConfig.intervalSeconds * 1000 });
  }

  function finishInterval(occurred: boolean) {
    if (!enabled || !intervalState || intervalState.targetId !== target.id) return;
    const expired = new Date().getTime() >= intervalState.endsAt;
    if ((occurred && expired) || (!occurred && !expired)) return;
    changeCapture(target, (current) => ({
      ...current,
      opportunities: current.opportunities + 1,
      observations: [...current.observations, {
        id: randomUUID(),
        at: new Date().toISOString(),
        value: occurred ? 1 : 0,
        responseCode: occurred ? "I" : "X",
        intervalSeconds: target.sessionConfig.intervalSeconds,
      }],
    }));
    setIntervalState(null);
  }

  function openAbc() {
    setAbcForm({ antecedent: "", behavior: "", consequence: "", intensity: 3, activity: "", note: "" });
    setPanel("abc");
  }

  function saveAbc() {
    if (!abcForm.antecedent.trim() || !abcForm.behavior.trim() || !abcForm.consequence.trim()) {
      Alert.alert("Completa el ABC", "Antecedente, conducta y consecuencia son obligatorios.");
      return;
    }
    const at = new Date().toISOString();
    const local = dateParts(at);
    const record: CollectionAbc = {
      id: randomUUID(),
      at,
      eventDate: local.date,
      eventTime: local.time,
      programId: target.programId,
      targetId: target.id,
      antecedent: abcForm.antecedent.trim(),
      behavior: abcForm.behavior.trim(),
      consequence: abcForm.consequence.trim(),
      intensity: abcForm.intensity,
      context: sessionDraft.context,
      activity: abcForm.activity.trim(),
      note: abcForm.note.trim(),
    };
    commit((current) => ({ ...current, abc: [...current.abc, record] }));
    setAbcForm({ antecedent: "", behavior: "", consequence: "", intensity: 3, activity: "", note: "" });
  }

  function closeSession() {
    try {
      if (!reviewable || !attested) throw new Error("Confirma la revisión de datos y firma el cierre.");
      if (!signatureStrokes.length) throw new Error("La firma del terapeuta es obligatoria.");
      const current = currentRef.current!;
      const coordinatorStarted = coordinatorStrokes.length > 0 || Boolean(current.closing?.coordinatorName.trim());
      if (coordinatorStarted && (!coordinatorStrokes.length || !current.closing?.coordinatorName.trim())) throw new Error("Para agregar la firma opcional del coordinador, completa nombre y trazo.");
      const at = new Date().toISOString();
      const preflight: SessionPreflight = current.preflight || {
        version: 1,
        accountId: bootstrap.account.id,
        profileId: current.preparation.profile.id,
        checkedAt: at,
        timing: "recovered_draft",
        checks: { ...checks },
      };
      const therapistSignature: SessionSignature = {
        version: 1,
        accountId: bootstrap.account.id,
        name: bootstrap.account.displayName,
        signedAt: at,
        attested: true,
        strokes: signatureStrokes,
      };
      const coordinatorSignature: SessionSignature | undefined = coordinatorStrokes.length ? {
        version: 1,
        accountId: "",
        name: current.closing!.coordinatorName.trim(),
        signedAt: at,
        attested: true,
        strokes: coordinatorStrokes,
      } : undefined;
      const closed = closeCollectionDraft({
        ...current,
        preflight,
        signature: therapistSignature,
        closing: { ...current.closing!, coordinatorSignature },
      }, at, randomUUID);
      save(closed);
      currentRef.current = closed;
      setPanel(null);
      void synchronize();
    } catch (error) {
      Alert.alert("Revisa antes de cerrar", error instanceof Error ? error.message : "Completa la revisión.");
    }
  }

  const summary = <View style={s.stack}>{draft.preparation.programs.map((program) => <View key={program.id} style={s.card}>
    <Text style={s.heading}>{program.name}</Text>
    {program.targets.map((item) => {
      const state = targetStatus(item, draft.captures[item.id]);
      const label = summaryLabel(item, draft.captures[item.id]);
      return <View key={item.id} style={s.summaryRow}><View style={s.flex}><Text style={s.body}>{item.code} · {item.name}</Text><Text style={s.meta}>{resultText(item, draft.captures[item.id])}</Text></View><Text style={[s.summaryStatus, label === "Cumple" ? s.summaryMet : label === "Muestra corta" ? s.summaryShort : label === "No cumple" ? s.summaryNotMet : null]}>{label}</Text>{state.minimumMet ? null : null}</View>;
    })}
  </View>)}</View>;

  if (!working) return <SafeAreaView style={s.safe} edges={["top", "bottom"]}><ScrollView contentContainerStyle={s.page}>
    <View style={s.card}>
      <Text style={s.title}>{draft.status === "synced" ? "Sesión sincronizada" : draft.status === "pending" ? "Pendiente de sincronizar" : "Revisión necesaria"}</Text>
      <Text style={s.body}>{draft.status === "synced" ? "Los datos, la nota y los registros ABC están guardados. El motor clínico ya evaluó los resultados." : draft.syncError || "Los datos están guardados en el teléfono y se enviarán cuando haya conexión."}</Text>
      {draft.status === "pending" ? <Button disabled={syncing} onPress={() => void synchronize()}>{syncing ? "Sincronizando…" : "Reintentar sincronización"}</Button> : null}
      {draft.status === "conflict" && draft.syncErrorCode === "session_review_required" ? <Button onPress={() => { setChecks({ identity: false, programs: false, materials: false }); setSignatureStrokes([]); setCoordinatorStrokes([]); setAttested(false); setPanel("review"); }}>Revisar y volver a firmar</Button> : null}
      {draft.status === "conflict" && ["configuration_changed", "template_changed"].includes(draft.syncErrorCode) ? <Button disabled={preparing} onPress={() => void refreshConflict()}>Revisar configuración actual</Button> : null}
      {draft.status === "conflict" && draft.syncErrorCode === "historical_mastery_review" ? <Button onPress={() => Alert.alert("Confirmar recálculo histórico", "Cambiará la fecha o la evidencia de un dominio ya registrado. La confirmación quedará auditada con tu cuenta.", [
        { text: "Volver", style: "cancel" },
        { text: "Confirmar recálculo", onPress: () => { commit((current) => ({ ...current, confirmHistoricalImpact: true, syncError: "Confirma el recálculo con una nueva firma.", syncErrorCode: "session_review_required" })); setPanel("review"); } },
      ])}>Revisar impacto histórico</Button> : null}
      <Button quiet onPress={() => setPanel("note")}>Consultar nota y ABC</Button>
      <Button quiet onPress={() => setPanel("review")}>Consultar firma y resumen</Button>
      <Button quiet onPress={() => selectDraft(null)}>Volver a sesiones</Button>
    </View>
    {summary}
    {renderPanel()}
  </ScrollView></SafeAreaView>;

  return <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
    <View style={s.sessionHeader}>
      <View style={s.row}>
        <Pressable accessibilityRole="button" accessibilityLabel="Salir de la sesión" onPress={requestLeave} style={s.back}><Text style={s.backText}>‹</Text></Pressable>
        <View style={s.flex}><Text style={s.heading}>{draft.preparation.profile.fullName}</Text><Text style={s.meta}>{draft.context} · {targets.length} targets · Guardado local</Text></View>
        <Pressable accessibilityRole="button" onPress={togglePause} style={[s.clockButton, !draft.runningSince && s.clockPaused]}><Text style={s.clockAction}>{draft.runningSince ? "Pausar" : "Reanudar"}</Text><Text style={s.clock}>{clock(elapsed)}</Text></Pressable>
      </View>
      <View style={s.toolbar}>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: view === "take" }} onPress={() => setView("take")} style={[s.tool, view === "take" && s.toolActive]}><Text style={[s.toolText, view === "take" && s.toolTextActive]}>Tomar</Text></Pressable>
        <Pressable accessibilityRole="tab" accessibilityState={{ selected: view === "sheet" }} onPress={() => setView("sheet")} style={[s.tool, view === "sheet" && s.toolActive]}><Text style={[s.toolText, view === "sheet" && s.toolTextActive]}>Hoja</Text></Pressable>
        {draft.preparation.canRecordAbc ? <Pressable onPress={openAbc} style={s.tool}><Text style={s.toolText}>ABC · {draft.abc.length}</Text></Pressable> : null}
        <Pressable onPress={() => setPanel("note")} style={s.tool}><Text style={s.toolText}>Nota</Text></Pressable>
        <Pressable onPress={() => setPanel("review")} style={s.toolFinish}><Text style={s.toolFinishText}>Cerrar</Text></Pressable>
      </View>
    </View>
    {!draft.runningSince ? <View style={s.pausedBanner}><Text style={s.pausedText}>Sesión en pausa. La toma está desactivada.</Text><Button compact onPress={togglePause}>Reanudar</Button></View> : null}
    {storageError ? <Text style={s.error}>{storageError}</Text> : null}
    {view === "sheet" ? <ScrollView contentContainerStyle={[s.page, width >= 900 && s.sheetWide]} keyboardShouldPersistTaps="handled">
      <View style={s.row}><View style={s.flex}><Text style={s.title}>Hoja de datos</Text><Text style={s.meta}>Todos los targets · {targets.filter((item) => capturedResult(item, draft.captures[item.id]).sampled).length}/{targets.length} con datos</Text></View></View>
      <View style={width >= 900 ? s.sheetGrid : undefined}>{targets.map((item) => <SheetTargetCard key={item.id} item={item} capture={draft.captures[item.id]} enabled={enabled} wide={width >= 900} onOpen={selectTarget} onTrial={recordTrial} onFrequency={adjustFrequency} />)}</View>
    </ScrollView> : <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.targetRail}>{targets.map((item) => {
        const itemCapture = draft.captures[item.id] || blankCapture(item);
        const itemStatus = targetStatus(item, itemCapture);
        const itemLast = activeObservations(itemCapture).at(-1)?.responseCode || item.lastPromptCode;
        return <Pressable key={item.id} onPress={() => selectTarget(item.id)} style={[s.targetTab, item.id === target.id && s.targetActive, itemStatus.minimumMet && (itemStatus.evaluation.status === "met" ? s.sampleMet : s.sampleReady)]}>
          <Text style={s.targetCode}>{item.code || item.name}</Text>
          <Text style={s.meta}>Ayuda: {itemLast || "—"}</Text>
          <Text style={s.meta}>{resultText(item, itemCapture)}</Text>
        </Pressable>;
      })}</ScrollView>
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <View style={s.card}>
          <View style={s.row}><Text style={s.phase}>{phase(target.state)}</Text><Text style={s.meta}>{target.programName} · {measurement(target.measurement)}{probe ? " · Sonda" : ""}</Text></View>
          <Text style={s.title}>{target.code} · {target.name}</Text>
          <Text style={s.body}><Text style={s.label}>Objetivo: </Text>{target.specificObjective || "No configurado"}</Text>
          <Text style={s.sd}><Text style={s.label}>SD: </Text>{target.sessionConfig.discriminativeStimulus || "No configurado"}</Text>
          <View style={s.metrics}>
            <View style={s.metric}><Text style={s.metricValue}>{status.result.correct || 0}/{status.result.opportunities}</Text><Text style={s.meta}>Independientes</Text></View>
            <View style={s.metric}><Text style={s.metricValue}>{status.result.value ?? 0}{isDiscrete(target.measurement) ? "%" : ""}</Text><Text style={s.meta}>Resultado</Text></View>
            <View style={s.metric}><Text style={s.metricValueSmall}>{responseLabel(lastResponse || target.lastPromptCode)}</Text><Text style={s.meta}>Última ayuda</Text></View>
          </View>
          <View style={[s.sampleBox, status.minimumMet && (status.evaluation.status === "met" ? s.sampleMet : s.sampleReady)]}>
            <Text style={s.label}>{status.minimumMet ? status.evaluation.status === "met" ? "Muestra y criterio cumplidos" : "Muestra mínima completa" : `${status.result.opportunities}/${status.criterion.minTrials} oportunidades mínimas`}</Text>
            <Text style={s.meta}>Criterio: {status.criterion.operator === "gte" ? "≥" : "≤"}{status.criterion.threshold}{status.criterion.metric === "percentage_correct" ? "%" : ""} · {status.criterion.requiredSessions} sesiones{status.criterion.consecutive ? " consecutivas" : ""}</Text>
          </View>
          <Button quiet onPress={() => setInstructionsOpen((open) => !open)}>{instructionsOpen ? "Ocultar cómo enseñar" : "Cómo enseñar"}</Button>
          {instructionsOpen ? <Text style={s.body}>{target.sessionConfig.teachingInstructions || target.programInstructions || target.programObjective || "No se han configurado instrucciones de enseñanza."}</Text> : null}

          {isDiscrete(target.measurement) && target.measurement !== "partial_interval" ? <View style={s.stack}>
            {target.measurement === "task_analysis" ? <View style={s.taskStep}><Text style={s.phase}>{taskStepIndex + 1}/{steps.length}</Text><View style={s.flex}><Text style={s.meta}>Paso actual de la cadena</Text><Text style={s.heading}>{steps[taskStepIndex]}</Text></View></View> : null}
            <View style={s.responseGrid}>{RESPONSES.filter((item) => !probe || item.code === "I" || item.code === "X" || probePromptsOpen).map((item) => <Pressable accessibilityRole="button" key={item.code} disabled={!enabled} onPress={() => recordTrial(target, item.code)} style={[s.responseKey, item.code === "I" ? s.responseIndependent : item.code === "X" ? s.responseIncorrect : s.responsePrompt, !enabled && s.disabled]}><Text style={s.responseCode}>{item.code}</Text><Text style={s.responseText}>{item.label}</Text></Pressable>)}</View>
            {probe && !probePromptsOpen ? <Button quiet disabled={!enabled} onPress={() => setProbePromptsOpen(true)}>Registrar una ayuda que ocurrió</Button> : null}
            {lastResponse ? <Text style={[s.guidance, lastResponse === "I" ? s.guidanceGood : lastResponse === "X" ? s.guidanceError : s.guidancePrompt]}>{lastResponse === "I" ? "Siga sin ayuda." : lastResponse === "X" ? "Corrija con el mínimo de ayuda y vuelva a presentar el SD sin ayuda." : "En el siguiente ensayo intente independiente o un nivel menos de ayuda."}</Text> : null}
            <View style={s.trialStrip}>{observations.slice(-20).map((item, index) => <View key={item.id} style={[s.trialToken, item.responseCode === "I" ? s.trialIndependent : item.responseCode === "X" ? s.trialIncorrect : s.trialPrompt]}><Text style={s.trialNumber}>{Math.max(1, observations.length - 19 + index)}</Text><Text style={s.trialCode}>{item.responseCode || (item.value ? "I" : "X")}</Text></View>)}</View>
            <Button quiet disabled={!observations.length || !enabled} onPress={() => undo()}>Deshacer último ensayo</Button>
          </View> : null}

          {target.measurement === "frequency" ? <View style={s.stack}>
            <Text style={s.score}>{frequencyCount}</Text><Text style={s.scoreCaption}>ocurrencias · {rate === null ? "inicia la observación" : `${rate} por minuto`}</Text>
            <View style={s.row}><View style={s.flex}><Button disabled={!enabled} onPress={() => adjustFrequency(target, 1)}>+1</Button></View><View style={s.flex}><Button disabled={!enabled} onPress={() => adjustFrequency(target, 5)}>+5</Button></View></View>
            <Button disabled={!enabled} quiet onPress={toggleFrequencyObservation}>{capture.frequencyObservationStartedAt ? `Detener observación · ${clock(frequencyObservationMs / 1000)}` : `Iniciar observación · ${clock(frequencyObservationMs / 1000)}`}</Button>
          </View> : null}

          {(target.measurement === "duration" || target.measurement === "latency") ? <View style={s.stack}>
            <Text style={s.score}>{clock(measuredSeconds)}</Text><Text style={s.scoreCaption}>Acumulado del día · {observations.length} registros guardados</Text>
            <Button disabled={!enabled} onPress={toggleMeasurementTimer}>{capture.timerStartedAt ? "Detener y guardar" : `Iniciar ${target.measurement === "duration" ? "duración" : "latencia"}`}</Button>
          </View> : null}

          {target.measurement === "partial_interval" ? <View style={s.stack}>
            <Text style={s.score}>{target.sessionConfig.intervalSeconds} s</Text>
            <Text style={s.scoreCaption}>{intervalState?.targetId === target.id ? intervalExpired ? "Intervalo terminado" : `${Math.max(0, Math.ceil((intervalState.endsAt - now) / 1000))} s restantes` : `${observations.length} intervalos guardados`}</Text>
            {!intervalState || intervalState.targetId !== target.id ? <Button disabled={!enabled} onPress={startInterval}>Iniciar intervalo</Button> : intervalExpired ? <Button disabled={!enabled} danger onPress={() => finishInterval(false)}>No ocurrió</Button> : <Button disabled={!enabled} onPress={() => finishInterval(true)}>Ocurrió</Button>}
            <Text style={s.meta}>{intervalState?.targetId === target.id && !intervalExpired ? "Durante el intervalo solo se puede marcar Ocurrió." : intervalExpired ? "Ahora puedes registrar No ocurrió." : "Inicia el reloj para observar."}</Text>
          </View> : null}

          <Field label="Nota breve del target" value={capture.note} onChange={(note) => changeCapture(target, (current) => ({ ...current, note }))} placeholder="Contexto, ayuda o variable observable" />
        </View>
        <View style={s.navigation}><Button quiet disabled={focusedIndex === 0} onPress={() => selectTarget(targets[focusedIndex - 1]!.id)}>‹ Anterior</Button><Text style={s.meta}>{focusedIndex + 1} de {targets.length}</Text><Button quiet disabled={focusedIndex === targets.length - 1} onPress={() => selectTarget(targets[focusedIndex + 1]!.id)}>Siguiente ›</Button></View>
      </ScrollView>
    </>}
    {renderPanel()}
  </SafeAreaView>;

  function renderPanel() {
    return <Modal visible={Boolean(panel)} animationType="slide" onRequestClose={() => setPanel(null)}>
      <SafeAreaView style={s.safe} edges={["top", "bottom"]}><KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[s.sessionHeader, s.row]}><Text style={[s.heading, s.flex]}>{panel === "note" ? "Nota de sesión" : panel === "abc" ? "Registro ABC" : "Cerrar sesión"}</Text><Button quiet compact onPress={() => setPanel(null)}>Volver</Button></View>
        <ScrollView scrollEnabled={!drawing} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
          {panel === "note" ? <>
            <Text style={s.meta}>La nota se guarda mientras escribes y se envía al cerrar la sesión.</Text>
            {reviewable ? <View style={s.choiceGrid}>{sessionDraft.preparation.templates.map((template) => <Pressable key={template.id || template.name} onPress={() => commit((current) => ({ ...current, template }))} style={[s.choice, sessionDraft.template.id === template.id && s.choiceSelected]}><Text style={[s.choiceText, sessionDraft.template.id === template.id && s.choiceTextSelected]}>{template.name}</Text></Pressable>)}</View> : <Text style={s.heading}>{sessionDraft.template.name}</Text>}
            {reviewable ? <Field label="Contexto de la sesión *" value={sessionDraft.context} onChange={(context) => commit((current) => ({ ...current, context }))} multiline={false} max={1000} /> : <Text style={s.body}>{sessionDraft.context}</Text>}
            {sessionDraft.template.fields.map((field) => reviewable ? <Field key={field.id} label={`${field.label}${field.required ? " *" : ""}`} guidance={field.guidance} value={sessionDraft.noteValues[field.id] || ""} onChange={(value) => commit((current) => ({ ...current, noteValues: { ...current.noteValues, [field.id]: value } }))} /> : <View key={field.id} style={s.card}><Text style={s.heading}>{field.label}</Text><Text style={s.body}>{sessionDraft.noteValues[field.id] || "Sin contenido"}</Text></View>)}
            <Button quiet onPress={() => setPanel("abc")}>Ver registros ABC · {sessionDraft.abc.length}</Button>
          </> : panel === "abc" ? <>
            <Text style={s.meta}>Registra antecedente, conducta, consecuencia e intensidad sin salir de la toma.</Text>
            {working && sessionDraft.preparation.canRecordAbc ? <View style={s.card}>
              <Text style={s.heading}>Nuevo ABC · {target.code} · {target.name}</Text>
              <Field label="Antecedente *" value={abcForm.antecedent} onChange={(antecedent) => setAbcForm((current) => ({ ...current, antecedent }))} placeholder="Qué ocurrió inmediatamente antes" max={2000} />
              <Field label="Conducta observable *" value={abcForm.behavior} onChange={(behavior) => setAbcForm((current) => ({ ...current, behavior }))} placeholder="Qué hizo exactamente el niño" max={2000} />
              <Field label="Consecuencia *" value={abcForm.consequence} onChange={(consequence) => setAbcForm((current) => ({ ...current, consequence }))} placeholder="Qué ocurrió inmediatamente después" max={2000} />
              <Text style={s.label}>Intensidad</Text><View style={s.choiceGrid}>{[1, 2, 3, 4, 5].map((intensity) => <Pressable key={intensity} onPress={() => setAbcForm((current) => ({ ...current, intensity }))} style={[s.choice, abcForm.intensity === intensity && s.choiceSelected]}><Text style={[s.choiceText, abcForm.intensity === intensity && s.choiceTextSelected]}>{intensity}</Text></Pressable>)}</View>
              <Field label="Actividad" value={abcForm.activity} onChange={(activity) => setAbcForm((current) => ({ ...current, activity }))} max={300} />
              <Field label="Observación adicional" value={abcForm.note} onChange={(note) => setAbcForm((current) => ({ ...current, note }))} max={3000} />
              <Button onPress={saveAbc}>Agregar a la sesión</Button>
            </View> : null}
            {sessionDraft.abc.map((record, index) => <View key={record.id} style={s.card}>
              <Text style={s.heading}>Registro {index + 1} · {record.eventTime} · Intensidad {record.intensity || "—"}</Text>
              <Text style={s.meta}>{record.eventDate} · {sessionDraft.preparation.programs.flatMap((program) => program.targets).find((item) => item.id === record.targetId)?.name || "Sesión"}</Text>
              <Text style={s.label}>Antecedente</Text><Text style={s.body}>{record.antecedent}</Text>
              <Text style={s.label}>Conducta</Text><Text style={s.body}>{record.behavior}</Text>
              <Text style={s.label}>Consecuencia</Text><Text style={s.body}>{record.consequence}</Text>
            </View>)}
            {!sessionDraft.abc.length ? <Text style={s.meta}>No se han registrado eventos ABC en esta sesión.</Text> : null}
          </> : <>
            <Text style={s.title}>Cerrar sesión</Text>
            <Text style={s.body}>{sessionDraft.preparation.profile.fullName} · {clock(elapsed)} · {sessionDraft.abc.length} ABC</Text>
            <Text style={s.meta}>Al firmar, el servidor evaluará el criterio, contará las sesiones requeridas y aplicará la transición de fase correspondiente.</Text>
            {summary}
            <View style={s.card}>
              <Text style={s.heading}>Nota, actividades e incidentes</Text>
              {sessionDraft.template.fields.map((field) => reviewable ? <Field key={field.id} label={`${field.label}${field.required ? " *" : ""}`} guidance={field.guidance} value={sessionDraft.noteValues[field.id] || ""} onChange={(value) => commit((current) => ({ ...current, noteValues: { ...current.noteValues, [field.id]: value } }))} /> : <View key={field.id}><Text style={s.label}>{field.label}</Text><Text style={s.body}>{sessionDraft.noteValues[field.id] || "Sin contenido"}</Text></View>)}
              {reviewable ? <><Field label="Actividades realizadas" value={sessionDraft.closing?.activities || ""} onChange={(activities) => commit((current) => ({ ...current, closing: { ...current.closing!, activities } }))} /><Field label="Incidentes" value={sessionDraft.closing?.incidents || ""} onChange={(incidents) => commit((current) => ({ ...current, closing: { ...current.closing!, incidents } }))} placeholder="Describe los incidentes o indica que no hubo" /></> : null}
            </View>
            {reviewable ? <View style={s.card}>
              <Text style={s.heading}>Tutor y condiciones</Text>
              <Text style={s.label}>¿Estuvo el tutor?</Text><View style={s.row}><View style={s.flex}><Button quiet={!sessionDraft.closing?.guardianPresent} onPress={() => commit((current) => ({ ...current, closing: { ...current.closing!, guardianPresent: true } }))}>Sí</Button></View><View style={s.flex}><Button quiet={Boolean(sessionDraft.closing?.guardianPresent)} onPress={() => commit((current) => ({ ...current, closing: { ...current.closing!, guardianPresent: false, guardianName: "" } }))}>No</Button></View></View>
              {sessionDraft.closing?.guardianPresent ? <Field label="Nombre del tutor *" value={sessionDraft.closing.guardianName} onChange={(guardianName) => commit((current) => ({ ...current, closing: { ...current.closing!, guardianName } }))} multiline={false} max={300} /> : null}
              <Text style={s.label}>¿Preocupación médica o ambiental?</Text><View style={s.row}><View style={s.flex}><Button quiet={!sessionDraft.closing?.concernPresent} onPress={() => commit((current) => ({ ...current, closing: { ...current.closing!, concernPresent: true } }))}>Sí</Button></View><View style={s.flex}><Button quiet={Boolean(sessionDraft.closing?.concernPresent)} onPress={() => commit((current) => ({ ...current, closing: { ...current.closing!, concernPresent: false, concernNote: "" } }))}>No</Button></View></View>
              {sessionDraft.closing?.concernPresent ? <Field label="Describe la preocupación *" value={sessionDraft.closing.concernNote} onChange={(concernNote) => commit((current) => ({ ...current, closing: { ...current.closing!, concernNote } }))} /> : null}
            </View> : null}
            {!sessionDraft.preflight && reviewable ? <View style={s.card}><Text style={s.heading}>Revisión del borrador anterior</Text><Text style={s.meta}>Esta revisión queda fechada ahora y no se registra como realizada al inicio.</Text>{PREFLIGHT_ITEMS.map((item) => <CheckRow key={item.id} checked={checks[item.id]} onPress={() => setChecks((current) => ({ ...current, [item.id]: !current[item.id] }))} label={item.label} />)}</View> : null}
            <View style={s.card}>
              <Text style={s.heading}>Firma del terapeuta · obligatoria</Text><Text style={s.body}>{bootstrap.account.displayName}</Text>
              <SignaturePad label="Firma del terapeuta" strokes={reviewable ? signatureStrokes : sessionDraft.signature?.strokes || []} readOnly={!reviewable} onChange={(value) => { setSignatureStrokes(value); setAttested(false); }} onDrawing={setDrawing} />
              {reviewable ? <CheckRow checked={attested} onPress={() => setAttested((value) => !value)} label="Revisé los datos, la nota y los ABC. Confirmo este cierre con mi firma." /> : null}
            </View>
            {reviewable ? <View style={s.card}>
              <Text style={s.heading}>Firma del coordinador · opcional</Text>
              <Field label="Nombre del coordinador" value={sessionDraft.closing?.coordinatorName || ""} onChange={(coordinatorName) => commit((current) => ({ ...current, closing: { ...current.closing!, coordinatorName } }))} multiline={false} max={300} />
              <SignaturePad label="Firma opcional del coordinador" strokes={coordinatorStrokes} onChange={setCoordinatorStrokes} onDrawing={setDrawing} />
            </View> : null}
            {reviewable && !dataPresent ? <Button danger onPress={() => Alert.alert("Descartar sesión vacía", "Este borrador no contiene datos clínicos.", [{ text: "Volver", style: "cancel" }, { text: "Descartar", style: "destructive", onPress: discardEmptyAndLeave }])}>Descartar sesión vacía</Button> : null}
            {reviewable && dataPresent ? <Text style={s.lockedNotice}>El borrador clínico contiene datos y no puede descartarse.</Text> : null}
            {reviewable ? <Button disabled={!attested || !signatureStrokes.length || Boolean(storageError)} onPress={() => Alert.alert("Firmar el cierre", "La firma y los datos quedarán juntos en el registro de esta sesión.", [{ text: "Seguir revisando", style: "cancel" }, { text: "Firmar y sincronizar", onPress: closeSession }])}>Firmar cierre y sincronizar</Button> : null}
          </>}
        </ScrollView>
      </KeyboardAvoidingView></SafeAreaView>
    </Modal>;
  }
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  page: { padding: 16, gap: 14, paddingBottom: 36, width: "100%", maxWidth: 980, alignSelf: "center" },
  stack: { gap: 13 },
  title: { fontSize: 24, fontWeight: "800", color: colors.textStrong, lineHeight: 30 },
  heading: { fontSize: 17, fontWeight: "800", color: colors.textStrong, lineHeight: 23 },
  body: { fontSize: 16, lineHeight: 23, color: colors.text },
  meta: { fontSize: 13, lineHeight: 19, color: colors.textMuted },
  label: { fontSize: 15, fontWeight: "700", color: colors.text },
  miniLabel: { fontSize: 12, fontWeight: "800", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  button: { backgroundColor: colors.primary, minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 15, fontWeight: "800", color: "#fff", textAlign: "center" },
  quiet: { backgroundColor: colors.surfaceMuted },
  quietText: { color: colors.primaryStrong },
  danger: { backgroundColor: colors.coral },
  compactButton: { minHeight: 40, paddingHorizontal: 12, paddingVertical: 8 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.78 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 18, padding: 16, gap: 12 },
  row: { flexDirection: "row", gap: 9, alignItems: "center" },
  field: { gap: 7 },
  input: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 12, padding: 13, minHeight: 49, color: colors.text, fontSize: 16, backgroundColor: colors.surface },
  multiline: { minHeight: 96 },
  error: { backgroundColor: colors.coralSoft, padding: 13, color: colors.danger, fontSize: 15 },
  warning: { fontSize: 13, color: colors.warning, fontWeight: "800" },
  warningBox: { color: colors.warning, backgroundColor: colors.accentSoft, borderRadius: 11, padding: 12, fontSize: 14, lineHeight: 20 },
  checkRow: { minHeight: 54, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, flexDirection: "row", gap: 10, alignItems: "center", backgroundColor: colors.surface },
  checkRowSelected: { borderColor: colors.primary, backgroundColor: colors.surfaceMuted },
  checkMark: { width: 22, fontSize: 20, fontWeight: "800", color: colors.primary },
  alertGrid: { gap: 9 },
  alertCard: { borderRadius: 15, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, padding: 14, gap: 5 },
  alertWarning: { borderColor: colors.coral, backgroundColor: colors.coralSoft },
  alertSuccess: { borderColor: colors.success, backgroundColor: colors.successSoft },
  alertValue: { fontSize: 16, fontWeight: "700", color: colors.textStrong, lineHeight: 22 },
  choiceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: { minHeight: 42, justifyContent: "center", borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 11, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: colors.surface },
  choiceSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  choiceText: { fontSize: 14, fontWeight: "700", color: colors.text },
  choiceTextSelected: { color: "#fff" },
  programGroup: { gap: 9, paddingTop: 5 },
  sessionHeader: { backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, padding: 10, gap: 9 },
  back: { height: 48, width: 36, alignItems: "center", justifyContent: "center" },
  backText: { fontSize: 38, color: colors.primary, marginTop: -4 },
  clockButton: { minWidth: 92, borderRadius: 12, padding: 8, alignItems: "flex-end", backgroundColor: colors.surfaceMuted },
  clockPaused: { backgroundColor: colors.accentSoft },
  clockAction: { fontSize: 11, fontWeight: "800", color: colors.primaryStrong },
  clock: { fontSize: 20, fontWeight: "900", fontVariant: ["tabular-nums"], color: colors.textStrong },
  toolbar: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  tool: { minHeight: 39, paddingHorizontal: 12, borderRadius: 10, justifyContent: "center", backgroundColor: colors.surfaceMuted },
  toolActive: { backgroundColor: colors.primary },
  toolText: { fontSize: 14, fontWeight: "800", color: colors.primaryStrong },
  toolTextActive: { color: "#fff" },
  toolFinish: { minHeight: 39, paddingHorizontal: 14, borderRadius: 10, justifyContent: "center", backgroundColor: colors.success },
  toolFinishText: { fontSize: 14, fontWeight: "800", color: "#fff" },
  pausedBanner: { padding: 10, backgroundColor: colors.accentSoft, flexDirection: "row", gap: 10, alignItems: "center", justifyContent: "space-between" },
  pausedText: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.warning },
  targetRail: { paddingHorizontal: 10, paddingVertical: 9, gap: 8, backgroundColor: colors.surface },
  targetTab: { minWidth: 132, maxWidth: 190, minHeight: 82, borderRadius: 13, padding: 11, gap: 4, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  targetActive: { borderWidth: 2, borderColor: colors.primary, backgroundColor: colors.surfaceMuted },
  targetCode: { fontSize: 15, fontWeight: "800", color: colors.textStrong },
  phase: { backgroundColor: colors.accentSoft, color: colors.warning, fontSize: 12, fontWeight: "800", paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, overflow: "hidden" },
  sd: { fontSize: 16, lineHeight: 23, color: colors.text, borderLeftWidth: 4, borderLeftColor: colors.primary, paddingLeft: 11 },
  metrics: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  metric: { flex: 1, minWidth: 100, minHeight: 82, borderRadius: 13, padding: 11, backgroundColor: colors.surfaceMuted, justifyContent: "center" },
  metricValue: { fontSize: 25, fontWeight: "900", color: colors.textStrong, fontVariant: ["tabular-nums"] },
  metricValueSmall: { fontSize: 15, fontWeight: "800", color: colors.textStrong },
  sampleBox: { borderRadius: 13, borderWidth: 1, borderColor: colors.border, padding: 12, gap: 4, backgroundColor: colors.surfaceMuted },
  sampleReady: { borderColor: colors.primary, backgroundColor: colors.surfaceMuted },
  sampleMet: { borderColor: colors.success, backgroundColor: colors.successSoft },
  taskStep: { flexDirection: "row", gap: 12, alignItems: "center", backgroundColor: colors.surfaceMuted, borderRadius: 13, padding: 13 },
  responseGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  responseKey: { minHeight: 68, minWidth: 88, flexGrow: 1, borderRadius: 13, alignItems: "center", justifyContent: "center", padding: 8 },
  responseIndependent: { backgroundColor: colors.success },
  responsePrompt: { backgroundColor: colors.primary },
  responseIncorrect: { backgroundColor: colors.coral },
  responseCode: { fontSize: 22, fontWeight: "900", color: "#fff" },
  responseText: { fontSize: 12, fontWeight: "700", color: "#fff", textAlign: "center" },
  guidance: { borderRadius: 12, padding: 13, fontSize: 15, lineHeight: 21, fontWeight: "700" },
  guidanceGood: { backgroundColor: colors.successSoft, color: colors.success },
  guidancePrompt: { backgroundColor: colors.surfaceMuted, color: colors.primaryStrong },
  guidanceError: { backgroundColor: colors.coralSoft, color: colors.danger },
  trialStrip: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  trialToken: { width: 40, height: 47, borderRadius: 10, justifyContent: "center", alignItems: "center" },
  trialIndependent: { backgroundColor: colors.successSoft },
  trialPrompt: { backgroundColor: colors.surfaceMuted },
  trialIncorrect: { backgroundColor: colors.coralSoft },
  trialNumber: { fontSize: 10, color: colors.textMuted },
  trialCode: { fontSize: 15, fontWeight: "900", color: colors.textStrong },
  score: { fontSize: 50, fontWeight: "900", color: colors.textStrong, textAlign: "center", fontVariant: ["tabular-nums"] },
  scoreCaption: { fontSize: 15, color: colors.textMuted, textAlign: "center" },
  navigation: { flexDirection: "row", gap: 9, alignItems: "center", justifyContent: "space-between" },
  sheetWide: { maxWidth: 1180 },
  sheetGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  sheetCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 14, gap: 11 },
  sheetCardWide: { width: "48.8%" },
  resultLine: { fontSize: 17, fontWeight: "900", color: colors.textStrong },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  quickKey: { minWidth: 48, minHeight: 45, borderRadius: 10, alignItems: "center", justifyContent: "center", paddingHorizontal: 10 },
  quickIndependent: { backgroundColor: colors.success },
  quickPrompt: { backgroundColor: colors.primary },
  quickIncorrect: { backgroundColor: colors.coral },
  quickKeyText: { color: "#fff", fontSize: 15, fontWeight: "900" },
  summaryRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 11, flexDirection: "row", gap: 9, alignItems: "center" },
  summaryStatus: { borderRadius: 9, paddingHorizontal: 9, paddingVertical: 6, overflow: "hidden", backgroundColor: colors.surfaceMuted, color: colors.textMuted, fontSize: 12, fontWeight: "800" },
  summaryMet: { backgroundColor: colors.successSoft, color: colors.success },
  summaryShort: { backgroundColor: colors.accentSoft, color: colors.warning },
  summaryNotMet: { backgroundColor: colors.coralSoft, color: colors.danger },
  lockedNotice: { backgroundColor: colors.surfaceMuted, color: colors.textMuted, padding: 13, borderRadius: 12, fontSize: 14, textAlign: "center" },
});
