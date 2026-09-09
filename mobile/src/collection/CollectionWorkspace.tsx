import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Alert, AppState, BackHandler, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { evaluateResult, targetStateLabel, type CriterionStage, type TargetState } from "../../../lib/clinical-mastery.ts";
import { activeObservations, capturedResult, closeCollectionDraft, collectionDateTime, createCollectionDraft, isDiscrete, reviewCollectionConfiguration, stopCollectionClocks, targetDefinition, PREFLIGHT_ITEMS,
  type CollectionDraft, type CollectionPreparation, type Observation, type TargetCapture, type SessionPreflight, type SignaturePoint } from "../../../lib/mobile-collection.ts";
import type { Appointment, Bootstrap } from "../types";
import { mobileGet, MobileApiError } from "../lib/api";
import { colors } from "../theme";
import type { CollectionController } from "./useCollection";
import { SignaturePad } from "./SignaturePad";

type Props = { controller: CollectionController; bootstrap: Bootstrap; appointments: Appointment[]; accessToken: string; profileId: string | null; onBack: () => void };
type Panel = "note" | "abc" | "review" | "trials" | null;
const phase = (v: string) => ["baseline", "acquisition", "generalization", "maintenance", "closed"].includes(v) ? targetStateLabel(v as TargetState) : v;
const measurement = (v: string) => isDiscrete(v) ? "Ensayos discretos" : ({ frequency: "Frecuencia", duration: "Duración", latency: "Latencia" }[v] || v);
const clock = (seconds: number) => { const n = Math.max(0, Math.floor(seconds)); return `${String(Math.floor(n / 3600)).padStart(2, "0")}:${String(Math.floor(n / 60) % 60).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`; };
const dateParts = collectionDateTime;
function Button({ children, onPress, quiet = false, disabled = false }: { children: ReactNode; onPress: () => void; quiet?: boolean; disabled?: boolean }) {
  return <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={[s.button, quiet && s.quiet, disabled && s.disabled]}><Text style={[s.buttonText, quiet && s.quietText]}>{children}</Text></Pressable>;
}
function Field({ label, value, onChange, guidance, multiline = true, max = 12000 }: { label: string; value: string; onChange: (v: string) => void; guidance?: string; multiline?: boolean; max?: number }) {
  return <View style={s.field}><Text style={s.label}>{label}</Text>{guidance ? <Text style={s.meta}>{guidance}</Text> : null}<TextInput accessibilityLabel={label} value={value} onChangeText={onChange} multiline={multiline} maxLength={max} textAlignVertical="top" style={[s.input, multiline && s.multiline]} /></View>;
}

export function CollectionWorkspace({ controller, bootstrap, appointments, accessToken, profileId, onBack }: Props) {
  const { drafts, vault, save, synchronize, storageError, syncing } = controller;
  const [selectedId, setSelectedId] = useState<string | null>(() => drafts.find((d) => d.status === "active" && (!profileId || d.preparation.profile.id === profileId))?.id || null);
  const [preparation, setPreparation] = useState<CollectionPreparation | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [offlinePrep, setOfflinePrep] = useState(false);
  const [programId, setProgramId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [panel, setPanel] = useState<Panel>(null);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [manualValue, setManualValue] = useState("");
  const [checks, setChecks] = useState({ identity: false, programs: false, materials: false });
  const [signatureStrokes, setSignatureStrokes] = useState<SignaturePoint[][]>([]);
  const [attested, setAttested] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const [now, setNow] = useState(0);
  const draft = drafts.find((d) => d.id === selectedId) || null;
  const currentRef = useRef<CollectionDraft | null>(null);
  const saveRef = useRef(save);
  const backRef = useRef(onBack);
  useEffect(() => { currentRef.current = draft; saveRef.current = save; backRef.current = onBack; }, [draft, onBack, save]);

  function selectDraft(id: string | null) {
    setSelectedId(id); setSignatureStrokes([]); setAttested(false); setChecks({identity:false,programs:false,materials:false});
  }

  function commit(change: (d: CollectionDraft) => CollectionDraft) {
    const current = currentRef.current; if (!current) return;
    try { const next = { ...change(current), signature: undefined }; save(next); currentRef.current = next; setSignatureStrokes([]); setAttested(false); }
    catch (e) { Alert.alert("No se guardó el cambio", e instanceof Error ? e.message : "No cierres la sesión y vuelve a intentar."); }
  }
  useEffect(() => {
    const timer = setInterval(() => { setNow(Date.now()); }, 1000);
    const heartbeat = setInterval(() => {
      const d = currentRef.current;
      if (d?.status === "active" && AppState.currentState === "active") { try { saveRef.current({ ...d, lastActiveAt: new Date().toISOString() }); } catch {} }
    }, 5000);
    const listener = AppState.addEventListener("change", (state) => {
      const d = currentRef.current;
      if (state !== "active" && d?.status === "active") {
        try { const paused = stopCollectionClocks(d, new Date().toISOString(), randomUUID); saveRef.current(paused); currentRef.current = paused; } catch {}
      }
    });
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      const d = currentRef.current;
      if (d?.status === "active") { try { saveRef.current(stopCollectionClocks(d, new Date().toISOString(), randomUUID)); } catch { return true; } }
      backRef.current(); return true;
    });
    return () => { clearInterval(timer); clearInterval(heartbeat); listener.remove(); back.remove(); };
  }, []);

  async function prepare(profile: string, appointmentId: string | null) {
    if (!vault) return;
    setPreparing(true);
    setChecks({ identity: false, programs: false, materials: false });
    const key = `collection:${appointmentId || profile}`;
    try {
      const ready = await mobileGet<CollectionPreparation>(`/collection?profileId=${encodeURIComponent(profile)}${appointmentId ? `&appointmentId=${encodeURIComponent(appointmentId)}` : ""}`, accessToken);
      vault.cache(key, ready); setPreparation(ready); setOfflinePrep(false);
    } catch (e) {
      const cache = vault.cached<CollectionPreparation>(key);
      const transient = e instanceof MobileApiError && (!e.status || e.status >= 500);
      if (cache && transient && cache.professionalAccountId === bootstrap.account.id) { setPreparation(cache); setOfflinePrep(true); }
      else Alert.alert("No se pudo preparar", e instanceof Error ? e.message : "Abre esta cita con conexión para descargar programas y plantillas.");
    } finally { setPreparing(false); }
  }
  function begin() {
    if (!preparation) return;
    const activeDraft = drafts.find((d) => d.status === "active");
    if (activeDraft) {
      if (activeDraft.preparation.profile.id !== preparation.profile.id) {
        Alert.alert("Hay otra sesión abierta", `La sesión abierta corresponde a ${activeDraft.preparation.profile.fullName}. Ciérrala antes de iniciar otra terapia.`, [{text:"Volver",style:"cancel"},{text:"Revisar sesión abierta",onPress:()=>{selectDraft(activeDraft.id);setPreparation(null);}}]);
      } else { selectDraft(activeDraft.id); setPreparation(null); }
      return;
    }
    const duplicate = drafts.find((d) => preparation.appointment && d.preparation.appointment?.id === preparation.appointment.id);
    if (duplicate) { selectDraft(duplicate.id); setPreparation(null); return; }
    if (preparation.appointment && preparation.appointment.sessionDate !== dateParts(new Date()).date) {
      Alert.alert("Revisa la fecha de la cita", "Puedes preparar otras fechas, pero debes iniciar la terapia el día de su cita en Nicaragua."); return;
    }
    if (!PREFLIGHT_ITEMS.every((item) => checks[item.id])) { Alert.alert("Checklist previo", "Completa las tres verificaciones antes de iniciar."); return; }
    try {
      const at = new Date().toISOString(), next = createCollectionDraft(preparation, randomUUID(), at);
      next.preflight = { version: 1, accountId: bootstrap.account.id, profileId: preparation.profile.id, checkedAt: at, timing: "before_start", checks: { ...checks } };
      save(next); selectDraft(next.id); setPreparation(null);
    }
    catch (e) { Alert.alert("No se pudo iniciar", e instanceof Error ? e.message : "Revisa el guardado local."); }
  }
  function leave() {
    if (draft?.status === "active") {
      try { save(stopCollectionClocks(draft, new Date().toISOString(), randomUUID)); }
      catch { Alert.alert("No se pudo guardar", "No cierres la sesión. Revisa el espacio del teléfono."); return; }
    }
    onBack();
  }

  async function refreshConflict() {
    if (!draft) return;
    setPreparing(true);
    try {
      const old = draft.preparation;
      const fresh = await mobileGet<CollectionPreparation>(`/collection?profileId=${encodeURIComponent(old.profile.id)}${old.appointment ? `&appointmentId=${encodeURIComponent(old.appointment.id)}` : ""}`, accessToken);
      reviewCollectionConfiguration(draft, fresh);
      Alert.alert("Revisar la configuración vigente", "Se conservan los registros, la duración y la fecha del cierre. Revisa la nota y vuelve a firmar para aplicar los criterios actuales.", [
        { text: "Volver", style: "cancel" }, { text: "Revisar", onPress: () => {
          commit((d) => reviewCollectionConfiguration(d, fresh));
          setPanel("note");
        } },
      ]);
    } catch (e) { Alert.alert("Revisión necesaria", e instanceof Error ? e.message : "Los datos se conservan."); }
    finally { setPreparing(false); }
  }

  if (!draft) return <SafeAreaView style={s.safe}><ScrollView contentContainerStyle={s.page}>
    <Button quiet onPress={onBack}>‹ Volver</Button><Text style={s.title}>Sesiones</Text>
    <Text style={s.meta}>Prepara tu cita con conexión para disponer de programas, instrucciones y plantillas sin internet.</Text>
    {storageError ? <Text style={s.error}>{storageError}</Text> : null}
    {drafts.filter((d) => !profileId || d.preparation.profile.id === profileId).slice().reverse().map((d) => <View key={d.id} style={s.card}>
      <Text style={s.heading}>{d.preparation.profile.fullName}</Text><Text style={s.meta}>{d.preparation.appointment?.sessionDate || d.startedAt.slice(0,10)} · {d.status === "active" ? "Guardada en el teléfono · En pausa" : d.status === "pending" ? "Pendiente de sincronización" : d.status === "conflict" ? "Requiere revisión" : "Sincronizada"}</Text>
      <Button quiet onPress={() => { selectDraft(d.id); setPanel(null); }}>{d.status === "active" ? "Continuar sesión" : "Ver sesión"}</Button>
    </View>)}
    {preparation ? <View style={s.card}><Text style={s.title}>{preparation.profile.fullName}</Text><Text style={s.meta}>{offlinePrep ? "Preparación guardada en el teléfono" : "Preparación actualizada"} · {new Date(preparation.preparedAt).toLocaleString("es-NI")}</Text>
      {preparation.appointment?.notes ? <Text style={s.body}>{preparation.appointment.notes}</Text> : null}
      {preparation.programs.map((p) => <View key={p.id} style={s.divider}><Text style={s.heading}>{p.name}</Text><Text style={s.meta}>{p.targets.length} targets disponibles</Text><Text style={s.body}>{p.instructions || p.objective}</Text></View>)}
      <Text style={s.heading}>Checklist previo</Text>
      {PREFLIGHT_ITEMS.map((item) => <Pressable key={item.id} accessibilityRole="checkbox" accessibilityState={{checked:checks[item.id]}} onPress={() => setChecks((v)=>({...v,[item.id]:!v[item.id]}))} style={[s.input,s.row]}><Text style={s.label}>{checks[item.id] ? "✓" : "○"}</Text><Text style={[s.body,s.flex]}>{item.label}</Text></Pressable>)}
      <Button disabled={!PREFLIGHT_ITEMS.every((item)=>checks[item.id])} onPress={begin}>Iniciar sesión · Todos los programas</Button><Button quiet onPress={() => setPreparation(null)}>Volver a la agenda</Button>
    </View> : <>
      {appointments.filter((a) => a.canStart && (!profileId || a.profileId === profileId)).map((a) => <View key={a.id} style={s.card}><Text style={s.heading}>{a.profileName}</Text><Text style={s.body}>{a.sessionDate} · {a.startTime.slice(0,5)}–{a.endTime.slice(0,5)}</Text><Text style={s.meta}>{a.site} · {a.sessionType}</Text><Button disabled={preparing || !vault} onPress={() => void prepare(a.profileId, a.id)}>Preparar sesión</Button></View>)}
      {profileId && bootstrap.account.role !== "terapeuta" ? <Button disabled={preparing || !vault} onPress={() => void prepare(profileId, null)}>Sesión del niño sin cita</Button> : null}
      {!appointments.some((a) => a.canStart && (!profileId || a.profileId === profileId)) ? <Text style={s.meta}>No hay citas disponibles. Las sesiones del terapeuta se inician desde una cita asignada.</Text> : null}
    </>}
    {preparing ? <ActivityIndicator size="large" color={colors.primary} /> : null}
    <Button quiet disabled={syncing} onPress={() => void synchronize()}>{syncing ? "Sincronizando…" : "Sincronizar pendientes"}</Button>
  </ScrollView></SafeAreaView>;

  const program = draft.preparation.programs.find((p) => p.id === programId) || draft.preparation.programs[0]!;
  const target = program.targets.find((t) => t.id === targetId) || program.targets[0]!;
  const capture = draft.captures[target.id];
  const result = capturedResult(target, capture);
  const criterion = target.criteria[(target.state === "closed" ? "maintenance" : target.state) as CriterionStage];
  const evaluation = evaluateResult(result, criterion);
  const working = draft.status === "active";
  const reviewable = working || (draft.status === "conflict" && draft.syncErrorCode === "session_review_required");
  const enabled = working && Boolean(draft.runningSince) && !storageError;
  const elapsed = (draft.elapsedMs + (draft.runningSince ? Math.max(0, now - Date.parse(draft.runningSince)) : 0)) / 1000;
  const targetSeconds = (result.value || 0) + (capture?.timerStartedAt ? Math.max(0, now - Date.parse(capture.timerStartedAt)) / 1000 : 0);
  const observations = capture ? activeObservations(capture) : [];
  function changeCapture(change: (c: TargetCapture) => TargetCapture) {
    if (!enabled) return;
    commit((d) => {
      const initial = d.captures[target.id] || { targetId: target.id, definition: targetDefinition(target), observations: [], note: "", opportunities: 1, timerStartedAt: null };
      return { ...d, captures: { ...d.captures, [target.id]: change(initial) } };
    });
  }
  function add(value: number) { changeCapture((c) => ({ ...c, observations: [...c.observations, { id: randomUUID(), at: new Date().toISOString(), value }] })); }
  function undo(id?: string) {
    changeCapture((c) => { const last = id || activeObservations(c).at(-1)?.id; return { ...c, observations: c.observations.map((o) => o.id === last ? { ...o, removedAt: new Date().toISOString() } : o) }; });
  }
  function correct(observation: Observation) {
    if (!enabled) return;
    Alert.alert("Corregir ensayo", `Ensayo registrado: ${observation.value === 1 ? "Correcto" : "Incorrecto"}.`, [
      { text: "Volver", style: "cancel" }, { text: "Eliminar", onPress: () => undo(observation.id) },
      { text: "Cambiar respuesta", onPress: () => changeCapture((c) => ({ ...c, observations: [...c.observations.map((o) => o.id === observation.id ? { ...o, removedAt: new Date().toISOString() } : o), { id: randomUUID(), at: observation.at, value: observation.value === 1 ? 0 : 1, replaces: observation.id }] })) },
    ]);
  }
  function togglePause() {
    commit((d) => d.runningSince ? stopCollectionClocks(d, new Date().toISOString(), randomUUID) : { ...d, runningSince: new Date().toISOString() });
  }
  function closeSession() {
    try {
      if (!reviewable || !attested) throw new Error("Confirma la revisión de datos y firma el cierre.");
      const at = new Date().toISOString(), current = currentRef.current!;
      const preflight: SessionPreflight = current.preflight || { version: 1, accountId: bootstrap.account.id, profileId: current.preparation.profile.id, checkedAt: at, timing: "recovered_draft", checks: { ...checks } };
      const closed = closeCollectionDraft({ ...current, preflight, signature: { version: 1, accountId: bootstrap.account.id, name: bootstrap.account.displayName, signedAt: at, attested: true, strokes: signatureStrokes } }, at, randomUUID);
      save(closed); currentRef.current = closed; setPanel(null); void synchronize();
    } catch (e) { Alert.alert("Revisa antes de cerrar", e instanceof Error ? e.message : "Completa la revisión."); }
  }
  const summary = <View style={s.stack}>{draft.preparation.programs.map((p) => <View key={p.id} style={s.card}><Text style={s.heading}>{p.name}</Text>{p.targets.map((t) => {
    const r = capturedResult(t, draft.captures[t.id]); const c = t.criteria[(t.state === "closed" ? "maintenance" : t.state) as CriterionStage];
    return <View key={t.id} style={s.divider}><Text style={s.body}>{t.code} · {t.name}</Text><Text style={s.meta}>{r.sampled ? `${r.value}${isDiscrete(t.measurement) ? "%" : ` ${t.unitLabel || ""}`} · ${r.opportunities} oportunidades` : "No trabajado"}</Text>{r.sampled && r.opportunities < c.minTrials ? <Text style={s.warning}>Muestra insuficiente para criterio · mínimo {c.minTrials}</Text> : null}</View>;
  })}</View>)}</View>;

  return <SafeAreaView style={s.safe}>
    <View style={s.sessionHeader}><View style={s.row}><Pressable onPress={leave} accessibilityRole="button" style={s.back}><Text style={s.backText}>‹</Text></Pressable><View style={s.flex}><Text style={s.heading}>{draft.preparation.profile.fullName}</Text><Text style={s.meta}>{draft.status === "synced" ? "Sincronizada con CIE Nexus" : working ? "Guardada en este teléfono" : "Cerrada en el teléfono"}</Text></View><Text style={s.clock}>{clock(elapsed)}</Text></View>
      {working ? <View style={s.row}><Text style={[s.meta,s.flex]}>{draft.runningSince ? "Sesión en curso" : "En pausa · Revisa el tiempo al recuperar"}</Text><Button quiet onPress={togglePause}>{draft.runningSince ? "Pausar" : "Reanudar"}</Button></View> : null}
    </View>
    {storageError ? <Text style={s.error}>{storageError}</Text> : null}
    {!working ? <ScrollView contentContainerStyle={s.page}>
      <View style={s.card}><Text style={s.title}>{draft.status === "synced" ? "Sesión sincronizada" : draft.status === "pending" ? "Pendiente de sincronizar" : "Revisión necesaria"}</Text>
        <Text style={s.body}>{draft.status === "synced" ? "Los datos, la nota y los registros ABC están guardados. El motor clínico ya evaluó los resultados." : draft.syncError || "Los datos están guardados en el teléfono. Se enviarán automáticamente cuando haya conexión y la app esté abierta."}</Text>
        <Text style={s.meta}>El dominio y las gráficas se actualizan después de la confirmación del servidor.</Text>
        {draft.status === "pending" ? <Button disabled={syncing} onPress={() => void synchronize()}>{syncing ? "Sincronizando…" : "Reintentar sincronización"}</Button> : null}
        {draft.status === "conflict" && draft.syncErrorCode === "session_review_required" ? <Button onPress={() => { setChecks({identity:false,programs:false,materials:false});setSignatureStrokes([]);setAttested(false);setPanel("review"); }}>Revisar y firmar el borrador conservado</Button> : null}
        {draft.status === "conflict" && ["configuration_changed", "template_changed"].includes(draft.syncErrorCode) ? <Button disabled={preparing} onPress={() => void refreshConflict()}>Revisar configuración actual</Button> : null}
        {draft.status === "conflict" && draft.syncErrorCode === "historical_mastery_review" ? <Button onPress={() => Alert.alert("Confirmar recálculo histórico", "Cambiará la fecha o la evidencia de un dominio ya registrado. La confirmación quedará auditada con tu cuenta.", [{ text: "Volver", style: "cancel" }, { text: "Confirmar recálculo", onPress: () => { commit((d) => ({ ...d, confirmHistoricalImpact: true, syncError: "Confirma el recálculo con una nueva firma.", syncErrorCode: "session_review_required" })); setPanel("review"); } }])}>Revisar impacto histórico</Button> : null}
        <Button quiet onPress={() => setPanel("note")}>Consultar nota y ABC</Button><Button quiet onPress={() => selectDraft(null)}>Volver a sesiones</Button>
        <Button quiet onPress={() => setPanel("review")}>Consultar firma y resumen</Button>
      </View>{summary}
    </ScrollView> : <>
      <View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.programRail}>{draft.preparation.programs.map((p) => <Pressable key={p.id} accessibilityRole="tab" accessibilityState={{ selected: p.id === program.id }} onPress={() => { setProgramId(p.id); setTargetId(""); setManualValue(""); }} style={[s.programTab, p.id === program.id && s.programActive]}><Text style={[s.programText,p.id === program.id && s.programActiveText]}>{p.name}</Text><Text style={[s.meta,p.id === program.id && s.programActiveText]}>{p.targets.filter((t) => capturedResult(t,draft.captures[t.id]).sampled).length}/{p.targets.length} trabajados</Text></Pressable>)}</ScrollView></View>
      <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.targetRail}>{program.targets.map((t) => <Pressable key={t.id} onPress={() => { setTargetId(t.id); setManualValue(""); }} style={[s.targetTab,t.id === target.id && s.targetActive]}><Text style={s.label}>{t.code || t.name}</Text><Text style={s.meta}>{capturedResult(t,draft.captures[t.id]).sampled ? "Con datos" : "Pendiente"}</Text></Pressable>)}</ScrollView>
        <View style={s.card}><View style={s.row}><Text style={s.phase}>{phase(target.state)}</Text><Text style={s.meta}>{measurement(target.measurement)}</Text></View><Text style={s.title}>{target.name}</Text>{target.specificObjective ? <Text style={s.body}>{target.specificObjective}</Text> : null}
          <Text style={s.score}>{isDiscrete(target.measurement) ? result.value === null ? "—" : `${result.value}%` : ["duration","latency"].includes(target.measurement) ? clock(targetSeconds) : result.value === null ? "—" : String(result.value)}</Text>
          <Text style={s.scoreCaption}>{isDiscrete(target.measurement) ? `${result.correct || 0} correctos · ${result.opportunities} ensayos` : target.unitLabel || (target.measurement === "frequency" ? "ocurrencias" : "segundos")}</Text>
          {isDiscrete(target.measurement) ? <View style={s.row}><Pressable accessibilityRole="button" disabled={!enabled} onPress={() => add(1)} style={[s.capture,s.correct,!enabled && s.disabled]}><Text style={s.captureSymbol}>✓</Text><Text style={s.captureLabel}>Correcto</Text></Pressable><Pressable accessibilityRole="button" disabled={!enabled} onPress={() => add(0)} style={[s.capture,s.incorrect,!enabled && s.disabled]}><Text style={s.captureSymbol}>×</Text><Text style={s.captureLabel}>Incorrecto</Text></Pressable></View>
          : target.measurement === "frequency" ? <><Button disabled={!enabled} onPress={() => add(1)}>+ Registrar ocurrencia</Button>{!result.sampled ? <Button quiet disabled={!enabled} onPress={() => add(0)}>Registrar 0 observado</Button> : null}</>
          : <Button disabled={!enabled} onPress={() => changeCapture((c) => {
            const at = new Date().toISOString(); return c.timerStartedAt ? { ...c, timerStartedAt: null, observations: [...c.observations, { id: randomUUID(), at, value: Math.max(0, Math.round((Date.parse(at)-Date.parse(c.timerStartedAt))/1000)) }] } : { ...c,timerStartedAt: at };
          })}>{capture?.timerStartedAt ? "Detener cronómetro del target" : "Iniciar cronómetro del target"}</Button>}
          <Button quiet disabled={!enabled || !observations.length} onPress={() => undo()}>Deshacer último registro</Button>
          <View style={s.sample}><Text style={s.label}>{result.opportunities >= criterion.minTrials && result.sampled ? "Mínimo de oportunidades alcanzado" : `${result.opportunities}/${criterion.minTrials} oportunidades mínimas`}</Text><Text style={s.meta}>Criterio: {criterion.operator === "gte" ? "≥" : "≤"}{criterion.threshold}{criterion.metric === "percentage_correct" ? "%" : ""} · {criterion.requiredSessions} sesiones{criterion.consecutive ? " consecutivas" : ""}</Text>{evaluation.status === "insufficient_sample" ? <Text style={s.warning}>Muestra insuficiente para criterio. El resultado se conserva.</Text> : null}<Text style={s.meta}>Puedes seguir registrando después del mínimo.</Text></View>
          {isDiscrete(target.measurement) ? <><View style={s.trialGrid}>{observations.slice(-20).map((o,i) => <Pressable key={o.id} onPress={() => correct(o)} accessibilityLabel={`Ensayo ${Math.max(0,observations.length-20)+i+1}: ${o.value === 1 ? "correcto" : "incorrecto"}`} style={[s.trial,o.value === 1 ? s.trialCorrect : s.trialIncorrect]}><Text style={s.label}>{o.value}</Text></Pressable>)}</View><Button quiet onPress={() => setPanel("trials")}>Ver y corregir todos los ensayos</Button></>
          : <><View style={s.row}><TextInput accessibilityLabel="Valor manual" value={manualValue} onChangeText={setManualValue} keyboardType="decimal-pad" placeholder={target.measurement === "frequency" ? "Conteo total" : "Segundos totales"} style={[s.input,s.flex]} /><Button disabled={!enabled || manualValue.trim() === ""} quiet onPress={() => {
            const value = Number(manualValue.replace(",","."));
            if (!Number.isFinite(value) || value < 0 || (target.measurement === "frequency" && !Number.isInteger(value))) { Alert.alert("Valor inválido", "Registra un número no negativo; la frecuencia requiere enteros."); return; }
            changeCapture((c) => { const at = new Date().toISOString(); return { ...c,timerStartedAt:null,observations:[...c.observations.map((o) => o.removedAt ? o : { ...o,removedAt:at }),{ id:randomUUID(),at,value }] }; }); setManualValue("");
          }}>Guardar total</Button></View><Text style={s.meta}>Oportunidades de observación</Text><TextInput accessibilityLabel="Oportunidades de observación" keyboardType="number-pad" editable={enabled} value={String(capture?.opportunities ?? 1)} onChangeText={(v) => { if (/^\d+$/.test(v)) changeCapture((c) => ({ ...c,opportunities:Number(v) })); }} style={s.input}/></>}
          <Button quiet onPress={() => setInstructionsOpen(!instructionsOpen)}>{instructionsOpen ? "Ocultar instrucciones" : "Instrucciones del programa"}</Button>{instructionsOpen ? <Text style={s.body}>{program.instructions || program.objective || "No hay instrucciones adicionales."}</Text> : null}
          <Field label="Nota del target" value={capture?.note || ""} onChange={(note) => changeCapture((c) => ({ ...c,note }))} />
        </View>
      </ScrollView>
      <View style={s.footer}><Button quiet onPress={() => setPanel("note")}>Nota</Button>{draft.preparation.canRecordAbc ? <Button quiet onPress={() => setPanel("abc")}>ABC · {draft.abc.length}</Button> : null}<Button onPress={() => setPanel("review")}>Revisar cierre</Button></View>
    </>}
    <Modal visible={Boolean(panel)} animationType="slide" onRequestClose={() => setPanel(null)}>
      <SafeAreaView style={s.safe}><KeyboardAvoidingView style={s.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={[s.sessionHeader,s.row]}><Text style={[s.heading,s.flex]}>{panel === "note" ? "Nota de sesión" : panel === "abc" ? "Registro ABC" : panel === "trials" ? "Ensayos del target" : "Revisión antes del cierre"}</Text><Button quiet onPress={() => setPanel(null)}>Volver</Button></View>
        {panel === "trials" ? <FlatList data={observations} keyExtractor={(o) => o.id} contentContainerStyle={s.page} renderItem={({item,index}) => <Pressable onPress={() => correct(item)} style={[s.card,s.row]}><Text style={[s.body,s.flex]}>Ensayo {index+1}</Text><Text style={s.label}>{item.value === 1 ? "Correcto" : "Incorrecto"}</Text><Text style={s.meta}>{dateParts(new Date(item.at)).time}</Text></Pressable>}/>
        : <ScrollView scrollEnabled={!drawing} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
          {panel === "note" ? <>
            <Text style={s.meta}>La nota se guarda mientras escribes. Puedes volver a recolectar datos sin perderla.</Text>
            {reviewable ? <ScrollView horizontal contentContainerStyle={s.targetRail}>{draft.preparation.templates.map((t) => <Button key={t.id} quiet={t.id !== draft.template.id} onPress={() => Alert.alert("Cambiar plantilla", "Se conservarán las respuestas para campos con el mismo identificador. Revisa los campos nuevos antes de cerrar.", [{text:"Volver",style:"cancel"},{text:"Usar plantilla",onPress:()=>commit((d)=>({...d,template:t}))}])}>{t.name}</Button>)}</ScrollView> : <Text style={s.heading}>{draft.template.name}</Text>}
            {reviewable ? <Field label="Contexto de la sesión *" value={draft.context} onChange={(context)=>commit((d)=>({...d,context}))} multiline={false} max={1000}/> : <Text style={s.body}>{draft.context}</Text>}
            {draft.template.fields.map((f) => reviewable ? <Field key={f.id} label={`${f.label}${f.required ? " *" : ""}`} guidance={f.guidance} value={draft.noteValues[f.id] || ""} onChange={(v)=>commit((d)=>({...d,noteValues:{...d.noteValues,[f.id]:v}}))}/>
              : <View key={f.id} style={s.card}><Text style={s.heading}>{f.label}</Text><Text style={s.body}>{draft.noteValues[f.id] || "Sin contenido"}</Text></View>)}
            <Button quiet onPress={()=>setPanel("abc")}>Ver Registro ABC · {draft.abc.length}</Button>
          </> : panel === "abc" ? <>
            <Text style={s.meta}>Describe lo que ocurrió antes, la conducta observable y lo que ocurrió después.</Text>
            {working && draft.preparation.canRecordAbc ? <Button onPress={()=>commit((d)=>{const at=new Date().toISOString();const time=dateParts(new Date(at));return {...d,abc:[...d.abc,{id:randomUUID(),at,eventDate:time.date,eventTime:time.time,programId:program.id,targetId:target.id,antecedent:"",behavior:"",consequence:"",context:d.context,activity:"",note:""}]};})}>+ Nuevo registro ABC</Button> : null}
            {draft.abc.map((a,i)=><View key={a.id} style={s.card}><Text style={s.heading}>Registro {i+1} · {a.eventTime}</Text><Text style={s.meta}>{a.eventDate} · {draft.preparation.programs.flatMap((p)=>p.targets).find((t)=>t.id===a.targetId)?.name || "Sesión"}</Text>
              {([ ["antecedent","Antecedente *"], ["behavior","Conducta observable *"], ["consequence","Consecuencia *"], ["activity","Actividad"], ["context","Lugar o contexto"], ["note","Observación adicional"] ] as const).map(([key,label])=>working ? <Field key={key} label={label} value={a[key]} max={key === "note" ? 3000 : key === "context" || key === "activity" ? 300 : 2000} onChange={(v)=>commit((d)=>({...d,abc:d.abc.map((item)=>item.id===a.id?{...item,[key]:v}:item)}))}/>:<View key={key}><Text style={s.label}>{label}</Text><Text style={s.body}>{a[key] || "—"}</Text></View>)}
              {working && !a.antecedent && !a.behavior && !a.consequence ? <Button quiet onPress={()=>commit((d)=>({...d,abc:d.abc.filter((item)=>item.id!==a.id)}))}>Quitar registro vacío</Button>:null}
            </View>)}
            {!draft.abc.length ? <Text style={s.meta}>No se han registrado eventos ABC en esta sesión.</Text>:null}
          </> : <>
            <Text style={s.title}>{draft.preparation.profile.fullName}</Text><Text style={s.body}>Duración: {clock(elapsed)} · {draft.abc.length} registros ABC</Text>
            <Text style={s.meta}>Al cerrar, la sesión quedará guardada en el teléfono y en cola para sincronizar. Los criterios se evaluarán cuando el servidor confirme el guardado.</Text>
            {summary}<Button quiet onPress={()=>setPanel("note")}>Revisar nota obligatoria</Button>
            {!draft.preflight && reviewable ? <View style={s.card}><Text style={s.heading}>Revisión del borrador anterior</Text><Text style={s.meta}>Este borrador no tiene un checklist inicial. Esta revisión quedará fechada ahora; no se registrará como realizada al inicio.</Text>{PREFLIGHT_ITEMS.map((item)=><Pressable key={item.id} accessibilityRole="checkbox" accessibilityState={{checked:checks[item.id]}} onPress={()=>setChecks((v)=>({...v,[item.id]:!v[item.id]}))} style={[s.input,s.row]}><Text style={s.label}>{checks[item.id]?"✓":"○"}</Text><Text style={[s.body,s.flex]}>{item.label}</Text></Pressable>)}</View> : null}
            <Text style={s.heading}>Firma del profesional</Text><Text style={s.body}>{draft.signature?.name || bootstrap.account.displayName}</Text>
            <SignaturePad strokes={reviewable ? signatureStrokes : draft.signature?.strokes || []} readOnly={!reviewable} onChange={(v)=>{setSignatureStrokes(v);setAttested(false);}} onDrawing={setDrawing}/>
            {reviewable ? <Pressable accessibilityRole="checkbox" accessibilityState={{checked:attested}} onPress={()=>setAttested(!attested)} style={[s.input,s.row]}><Text style={s.label}>{attested?"✓":"○"}</Text><Text style={[s.body,s.flex]}>Revisé los datos, la nota y los ABC. Confirmo este cierre con mi firma.</Text></Pressable> : null}
            {draft.signature ? <Text style={s.meta}>Firmada el {new Date(draft.signature.signedAt).toLocaleString("es-NI")}</Text> : null}
            <Button disabled={!reviewable || !attested || !signatureStrokes.length || Boolean(storageError)} onPress={()=>Alert.alert("Firmar el cierre", "La firma y los datos quedarán juntos en el registro de esta sesión.",[{text:"Seguir revisando",style:"cancel"},{text:"Firmar y sincronizar",onPress:closeSession}])}>Firmar cierre y sincronizar</Button>
          </>}
        </ScrollView>}
      </KeyboardAvoidingView></SafeAreaView>
    </Modal>
  </SafeAreaView>;
}

const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:colors.canvas},flex:{flex:1},page:{padding:18,gap:15,paddingBottom:32,width:"100%",maxWidth:820,alignSelf:"center"},stack:{gap:14},
  title:{fontSize:24,fontWeight:"800",color:colors.textStrong,lineHeight:30},heading:{fontSize:18,fontWeight:"800",color:colors.textStrong},body:{fontSize:16,lineHeight:23,color:colors.text},meta:{fontSize:14,lineHeight:20,color:colors.textMuted},label:{fontSize:15,fontWeight:"700",color:colors.text},
  button:{backgroundColor:colors.primary,minHeight:48,paddingHorizontal:16,paddingVertical:12,borderRadius:13,alignItems:"center",justifyContent:"center"},buttonText:{fontSize:15,fontWeight:"800",color:"#fff",textAlign:"center"},quiet:{backgroundColor:colors.surfaceMuted},quietText:{color:colors.primaryStrong},disabled:{opacity:0.42},
  card:{backgroundColor:colors.surface,borderColor:colors.border,borderWidth:1,borderRadius:19,padding:18,gap:13},row:{flexDirection:"row",gap:10,alignItems:"center"},divider:{borderTopWidth:1,borderTopColor:colors.border,paddingTop:12,gap:5},field:{gap:7},input:{borderWidth:1,borderColor:colors.borderStrong,borderRadius:12,padding:13,minHeight:49,color:colors.text,fontSize:16,backgroundColor:colors.surface},multiline:{minHeight:100},error:{backgroundColor:colors.coralSoft,padding:14,color:colors.danger,fontSize:15},warning:{fontSize:14,color:colors.warning,lineHeight:20},
  sessionHeader:{backgroundColor:colors.surface,borderBottomWidth:1,borderBottomColor:colors.border,padding:12,gap:8},back:{height:48,width:40,alignItems:"center",justifyContent:"center"},backText:{fontSize:38,color:colors.primary},clock:{fontSize:20,fontWeight:"800",fontVariant:["tabular-nums"],color:colors.text},
  programRail:{padding:12,gap:9},programTab:{minWidth:150,maxWidth:250,borderRadius:14,padding:13,gap:5,backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border},programActive:{backgroundColor:colors.primary,borderColor:colors.primary},programText:{fontSize:16,fontWeight:"800",color:colors.text},programActiveText:{color:"#fff"},
  targetRail:{gap:9,paddingVertical:3},targetTab:{padding:12,borderRadius:12,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,minWidth:95,gap:5},targetActive:{borderWidth:2,borderColor:colors.primary,backgroundColor:colors.surfaceMuted},phase:{backgroundColor:colors.accentSoft,color:colors.warning,fontSize:14,fontWeight:"800",padding:8,borderRadius:9},
  score:{fontSize:48,fontWeight:"900",color:colors.textStrong,textAlign:"center",fontVariant:["tabular-nums"]},scoreCaption:{fontSize:16,color:colors.textMuted,textAlign:"center"},capture:{flex:1,minHeight:94,borderRadius:16,alignItems:"center",justifyContent:"center",gap:3},correct:{backgroundColor:colors.success},incorrect:{backgroundColor:colors.coral},captureSymbol:{fontSize:32,fontWeight:"800",color:"#fff"},captureLabel:{fontSize:17,fontWeight:"800",color:"#fff"},
  sample:{backgroundColor:colors.surfaceMuted,borderRadius:13,padding:13,gap:5},trialGrid:{flexDirection:"row",gap:7,flexWrap:"wrap"},trial:{height:44,minWidth:44,borderRadius:10,alignItems:"center",justifyContent:"center"},trialCorrect:{backgroundColor:colors.successSoft},trialIncorrect:{backgroundColor:colors.coralSoft},footer:{padding:10,backgroundColor:colors.surface,borderTopWidth:1,borderTopColor:colors.border,flexDirection:"row",gap:6,justifyContent:"space-around",flexWrap:"wrap"},
});
