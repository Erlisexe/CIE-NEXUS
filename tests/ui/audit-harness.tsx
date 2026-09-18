// Development-only UI fixture. No credentials, clinical data or network writes.
import React, { useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import InterventionSessionManager from "../../app/components/intervention-session-manager";
import CalendarManager from "../../app/components/calendar-manager";
import GraphManager from "../../app/components/graph-manager";
import ABCManager from "../../app/components/abc-manager";
import ToastNotice from "../../app/components/toast-notice";
import { createCollectionDraft, collectionDateTime, type CollectionPreparation, type CollectionDraft } from "../../lib/mobile-collection";
import { normalizeCriteria } from "../../lib/clinical-mastery";
import { DEFAULT_SESSION_NOTE_TEMPLATE } from "../../lib/session-note-templates";
import "../../app/globals.css";
import "../../app/accessibility.css";

// The managed preview is HTTP. HTTPS production supplies randomUUID natively.
let testId = 0;
if (!crypto.randomUUID) Object.defineProperty(crypto, "randomUUID", { value: () => `00000000-0000-4000-8000-${String(++testId).padStart(12, "0")}` });

const today = collectionDateTime(new Date()).date;
const profile = { id: "qa-child", role: "Niño", evaluationCount: 0, programCount: 1, sessionCount: 0, fullName: "Caso ficticio QA", site: "León", status: "active" as const, internalCode: "QA", dateOfBirth: "", diagnosis: "", address: "", phone: "", guardianName: "", guardianPhone: "", preferredLanguage: "es", emergencyContact: "", customFields: [], notes: "", createdAt: "", updatedAt: "" };
const program = { id: "qa-program", profileId: profile.id, linkedCycleId: null, participantName: profile.fullName, site: "León", name: "Programa sintético", objective: "Pruebas de interacción", instructions: "Datos ficticios; no usar clínicamente.", status: "active", updatedAt: "", graphConfig: { graphType: "line", designType: "AB", clinicalMetric: "percentage", clinicalGrouping: "session", showPoints: true, showLegend: true, primaryTargetId: null }, targets: ["discrete_trials", "frequency", "duration", "latency", "partial_interval", "task_analysis"].map((measurement, i) => ({ id: `qa-target-${i}`, code: `T${i + 1}`, name: ["Ensayo", "Frecuencia", "Duración", "Latencia", "Intervalo", "Cadena"][i], specificObjective: "Objetivo de prueba", measurement, unitLabel: "%", state: "acquisition" as const, lastPromptCode: "G" as const, criteria: normalizeCriteria({ acquisition: { minTrials: 3 } }, measurement), sessionConfig: { discriminativeStimulus: "SD de prueba", teachingInstructions: "Instrucciones de prueba", taskSteps: ["Paso uno", "Paso dos"], intervalSeconds: 10 as const, maintenanceProbeEveryDays: 7 } })) };
const appointment = { id: "qa-appointment", professionalRole: "terapeuta" as const, cancellationCategory: null, cancellationReason: "", cancelledByAccountId: null, cancelledAt: null, profileId: profile.id, profileName: profile.fullName, professionalAccountId: "qa-professional", professionalName: "Profesional QA", site: "León", sessionDate: today, startTime: "09:00", endTime: "10:00", sessionType: "Prueba aislada", notes: "", status: "scheduled" as const, canStart: true, hasClinicalEvidence: false, clinicalSessionRunId: null, interventionSessionId: null };
const preparation: CollectionPreparation = { profile: { ...profile, clinicalAlerts: { allergies: "Alerta ficticia", medications: "No registrados", reinforcers: "Burbujas" } }, appointment, professionalAccountId: "qa-professional", professionalName: "Profesional QA", programs: [program], templates: [DEFAULT_SESSION_NOTE_TEMPLATE], canRecordAbc: true, preparedAt: new Date().toISOString() };
let storedDraft: CollectionDraft | null = null;
let failSave = false;
let failLoad = false;
let writes = 0;
let inFlight = 0;
let maxInFlight = 0;
let closedPayload = "";
let closeAttempts = 0;
const params = new URLSearchParams(location.search);
failSave = params.has("failSave");
failLoad = params.has("failLoad");
const delay = Number(params.get("delay") || 60);
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (!url.startsWith("/api/")) throw new Error("La prueba bloquea toda conexión fuera de sus fixtures.");
  inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
  try {
    await new Promise<void>((resolve, reject) => { const timer = setTimeout(resolve, delay); init?.signal?.addEventListener("abort", () => { clearTimeout(timer); reject(new DOMException("Cancelado", "AbortError")); }, { once: true }); });
    if (failLoad && (!init?.method || init.method === "GET")) return Response.json({ error: "Fallo de carga simulado" }, { status: 503 });
    if (url.startsWith("/api/personnel-profiles")) return Response.json({ profiles: [profile], linkableAccounts: [] });
    if (url.startsWith("/api/training-cycles")) return Response.json({ records: [] });
    if (url.startsWith("/api/evaluation-packages")) return Response.json({ packages: [] });
    if (url.startsWith("/api/settings")) return Response.json({ settings: { pageName: "CIE Nexus · QA", institutionPhotoUrl: null, platformPhotoUrl: null } });
    if (url.startsWith("/api/sites")) return Response.json({ sites: [{ id:"qa-site",name:"León",code:"QA",status:"active" }] });
    if (url.startsWith("/api/profile-photos")) return Response.json({ photoUrl: null });
    if (url.startsWith("/api/graphs")) return Response.json({ graphs: [] });
    if (url.startsWith("/api/abc-records")) return Response.json({ records: [], categories: [], programs: [program], targets: program.targets.map(t => ({ ...t,programId:program.id })), canManage: true, canRecord: true });
    if (url.startsWith("/api/meetings")) return Response.json({ requests: [], recipients: [], busyBlocks: [], currentAccountId: "qa-professional" });
    if (url.startsWith("/api/child-profile")) return Response.json({ profile, programs: [program], sessions: [], evaluations: [], graphs: [], reports: [], abcRecords: [], documents: [], capabilities: { evaluations:true,programs:true,sessions:true,graphs:true,reports:true,abc:true,manageChild:true } });
    if (url.startsWith("/api/intervention-programs")) return Response.json({ programs: [program], sessions: [] });
    if (url.startsWith("/api/calendar")) return Response.json({ appointments: [appointment], professionals: [{ id: "qa-professional", displayName: "Profesional QA", role: "terapeuta", eligibleProfileIds: [profile.id] }], canManage: true });
    if (url.startsWith("/api/session-note-templates")) return Response.json({ templates: [DEFAULT_SESSION_NOTE_TEMPLATE] });
    if (url.startsWith("/api/session-collection")) {
      const payload = JSON.parse(String(init?.body || "{}"));
      if (init?.method === "PUT") { writes++; if (failSave || writes <= Number(params.get("failWrites") || 0)) return Response.json({ error: "Fallo de guardado simulado" }, { status: 503 }); storedDraft = payload.draft; return Response.json({ saved: true }); }
      if (init?.method === "DELETE") { storedDraft = null; return Response.json({ discarded: true }); }
      if (payload.action === "start") { storedDraft = createCollectionDraft({ ...preparation, programs: [{ ...program, targets: program.targets.filter(t => payload.selectedTargetIds.includes(t.id)) }] }, crypto.randomUUID(), new Date().toISOString()); storedDraft.context = payload.contextCategory; storedDraft.preflight = { version:1,accountId:"qa-professional",profileId:profile.id,checkedAt:storedDraft.startedAt,timing:"before_start",checks:{identity:true,programs:true,materials:true} }; return Response.json({ draft: storedDraft }); }
      if (payload.action === "close") { closeAttempts++; const content=JSON.stringify(payload.payload); if(closedPayload && content !== closedPayload) return Response.json({error:"El reintento cambió los datos"},{status:409}); closedPayload=content; if(params.has("failClose") && closeAttempts===1) return Response.json({error:"Recibo no disponible, fallo simulado"},{status:503}); storedDraft=null; return Response.json({ receipt: { id: payload.payload.id } }); }
      return Response.json({ preparation, draft: storedDraft });
    }
    throw new Error(`Fixture no definida: ${url}`);
  } finally { inFlight--; }
};

function Harness() {
  const [screen, setScreen] = useState(params.get("module") || "sessions");
  const [notice, setNotice] = useState("");
  const [initialAppointment, setInitialAppointment] = useState<typeof appointment | null>(null);
  const consumeAppointment = useCallback(() => setInitialAppointment(null), []);
  return <><div className="formation-shell"><aside className="formation-sidebar"><button onClick={() => setScreen("calendar")}>Calendario QA</button><button onClick={() => setScreen("sessions")}>Sesiones QA</button></aside><section className="formation-workspace"><header className="formation-topbar"><strong>QA aislada · Sin datos reales</strong><label>Niño<select><option>Caso ficticio QA</option></select></label></header><main className="formation-content">
    <details><summary>Controles de prueba</summary><button onClick={() => { failSave = !failSave; setNotice(`Fallo guardado: ${failSave}`); }}>Simular fallo de guardado</button><button onClick={() => { failLoad = !failLoad; setNotice(`Fallo carga: ${failLoad}`); }}>Simular fallo de carga</button><button onClick={() => setNotice(`Escrituras: ${writes}; simultáneas: ${maxInFlight}; observaciones: ${Object.values(storedDraft?.captures || {}).reduce((sum,c)=>sum+c.observations.length,0)}`)}>Inspeccionar guardados</button></details>
    {screen === "graphs" ? <GraphManager cycles={[]} profiles={[profile]} selectedProfileId={profile.id} notify={setNotice} onOpenABC={()=>setScreen("abc")}/> : screen === "abc" ? <ABCManager profileId={profile.id} profileName={profile.fullName} notify={setNotice}/> : screen === "calendar" ? <CalendarManager compact={params.has("compact")} profiles={[profile]} notify={setNotice} onOpenSession={(a) => { setInitialAppointment(a as typeof appointment); setScreen("sessions"); }}/> : <InterventionSessionManager mode="sessions" profiles={[profile]} cycles={[]} selectedProfileId="all" selectedSite="Todas" onSelectProfile={() => undefined} onProfilesRefresh={() => undefined} notify={setNotice} canManagePrograms canRecordSessions canManageSessions allowAdHocSessions initialAppointment={initialAppointment} onAppointmentConsumed={consumeAppointment}/>}
  </main></section><ToastNotice message={notice}/></div></>;
}
createRoot(document.getElementById("root")!).render(<Harness/>);
