// Isolated fixtures for the actual directory, dossier, home calendar and collector.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import PersonnelProfileManager from "../../app/components/personnel-profile-manager";
import ClinicalScopeControls from "../../app/components/clinical-scope-controls";
import { profileMatchesClinicalFilter, readClinicalFilter, upcomingCalendarPeriod } from "../../lib/clinical-filter";
import CalendarManager from "../../app/components/calendar-manager";
import InterventionSessionManager from "../../app/components/intervention-session-manager";
import { summarizeClosedSessions } from "../../lib/clinical-session-runs";
import TodaySessionLauncher from "../../app/components/today-session-launcher";
import ToastNotice from "../../app/components/toast-notice";
import { collectionDateTime, createCollectionDraft, type CollectionDraft, type CollectionPreparation } from "../../lib/mobile-collection";
import { normalizeCriteria } from "../../lib/clinical-mastery";
import { DEFAULT_SESSION_NOTE_TEMPLATE } from "../../lib/session-note-templates";
import "../../app/globals.css";
import "../../app/accessibility.css";

let serial = 0;
if (!crypto.randomUUID) Object.defineProperty(crypto, "randomUUID", { value: () => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}` });
const params = new URLSearchParams(location.search);
const today = collectionDateTime(new Date()).date;
const profile = { id: "qa-child", fullName: "Niño ficticio QA", role: "Niño", site: "León", status: "active" as const, internalCode: "QA", dateOfBirth: "", diagnosis: "", address: "", phone: "", guardianName: "", guardianPhone: "", preferredLanguage: "es", emergencyContact: "", customFields: [], notes: "", createdAt: "", updatedAt: "", responsibles: [], programCount: 1, sessionCount: 0, evaluationCount: 0 };
const target = { id: "qa-target", code: "T01", name: "Pedir ayuda", specificObjective: "Objetivo ficticio", measurement: "discrete_trials", unitLabel: "%", state: "acquisition" as const, criteria: normalizeCriteria({ acquisition: { minTrials: 2 } }, "discrete_trials"), sessionConfig: { discriminativeStimulus: "¿Qué necesitas?", teachingInstructions: "Instrucción ficticia", taskSteps: [], intervalSeconds: 30 as const, maintenanceProbeEveryDays: 7 } };
const program = { id: "qa-program", profileId: profile.id, name: "Comunicación QA", objective: "Prueba aislada", instructions: "", status: "active", updatedAt: "", targets: [target] };
const encounterPrograms = [{ ...program, participantName: profile.fullName, site: profile.site, name: "Comunicación funcional" }, { ...program, id: "qa-social", participantName: profile.fullName, site: profile.site, name: "Social" }];
const encounterRecords = ["visit-1", "visit-2", "visit-3", "visit-3", "visit-4"].map((run, i) => ({ id: `qa-record-${i}`, clinicalSessionRunId: run, programId: i===3 ? "qa-social" : program.id, programName: i===3 ? "Social" : "Comunicación funcional", status: "closed", sessionDate: today, context: "Mesa", notes: "Nota ficticia conservada.", professionalName: "Terapeuta QA", results: [], transitions: [], createdAt: new Date().toISOString() }));
const encounterSummary = summarizeClosedSessions(encounterRecords);
const entryProfile = params.has("encounters") ? {...profile, sessionCount: encounterSummary.sessionCount, programRecordCount: encounterSummary.programRecordCount, programCount:2} : profile;
const appointment = { id: "qa-appointment", profileId: profile.id, profileName: profile.fullName, professionalAccountId: "qa-professional", professionalName: "Terapeuta QA", professionalRole: "terapeuta" as const, site: "León", sessionDate: today, startTime: "09:00", endTime: "10:00", sessionType: "Terapia individual", notes: "", status: "scheduled" as const, canStart: !params.has("readonly"), hasClinicalEvidence: false, clinicalSessionRunId: null, interventionSessionId: null, cancellationCategory: null, cancellationReason: "", cancelledByAccountId: null, cancelledAt: null };
const fixtureSites = ["León", "Estelí", "Las Colinas", "Santo Domingo", "Masaya", "Estelí"];
const scopeProfiles = fixtureSites.map((site, index) => ({ ...profile, id:`scope-child-${index}`, site, fullName:`Niño QA ${index + 1}` }));
const scopeAppointments = scopeProfiles.map((child,index) => ({ ...appointment, id:`scope-appointment-${index}`, profileId:child.id, profileName:child.fullName, site:child.site, profileSite:child.site }));
let lastProgrammed = "";
const preparation: CollectionPreparation = { profile: { ...profile, clinicalAlerts: { allergies: "Alerta ficticia", medications: "No registrados", reinforcers: "Burbujas" } }, appointment, professionalAccountId: "qa-professional", professionalName: "Terapeuta QA", programs: [program], templates: [DEFAULT_SESSION_NOTE_TEMPLATE], canRecordAbc: true, preparedAt: new Date().toISOString() };
let draft: CollectionDraft | null = null;
let starts = 0;
let fail = params.has("fail");
const requests: string[] = [];
if (params.has("resume")) draft = createCollectionDraft(preparation, crypto.randomUUID(), new Date().toISOString());
globalThis.fetch = async (input, init) => {
  const url = String(input); if (!url.startsWith("/api/")) throw new Error("Conexión fuera del fixture bloqueada");
  requests.push(`${init?.method || "GET"} ${url}`);
  await new Promise((resolve) => setTimeout(resolve, params.has("scope") && url.includes("Estel") ? 650 : 60));
  if (params.has("scope") && url.startsWith("/api/calendar")) {
    if (init?.method === "POST" || init?.method === "PUT") { const body=JSON.parse(String(init.body)); lastProgrammed=JSON.stringify(body); return Response.json({appointment:{...appointment,...body}}); }
    const query=new URL(url,location.origin).searchParams;
    const filter=readClinicalFilter(query);
    const ids=scopeProfiles.filter(p=>profileMatchesClinicalFilter(p,filter)).map(p=>p.id);
    const rows=scopeAppointments.filter(a=>ids.includes(a.profileId));
    return Response.json({appointments:rows,upcomingAppointments:rows,upcomingPeriod:upcomingCalendarPeriod(today),professionals:[{id:"qa-professional",displayName:"Profesional QA",role:"terapeuta",eligibleProfileIds:ids}],canManage:true});
  }
  if (url.startsWith("/api/intervention-programs") && params.has("encounters")) return Response.json({ programs: encounterPrograms, sessions: encounterRecords, history: [] });
  if (url.startsWith("/api/child-profile")) return Response.json({ profile: entryProfile, programs: params.has("encounters") ? encounterPrograms : [program], sessions: params.has("encounters") ? encounterRecords : [], evaluations: [], graphs: [], reports: [], abcRecords: [], documents: [], capabilities: { evaluations:true,programs:true,sessions:true,graphs:true,reports:true,abc:true,manageChild:false } });
  if (url.startsWith("/api/calendar")) return Response.json({ appointments: [appointment, { ...appointment, id:"qa-future", sessionDate:"2099-01-01" }], professionals: [], canManage:false });
  if (url.startsWith("/api/session-collection")) {
    const query = new URL(url, location.origin).searchParams;
    const body = JSON.parse(String(init?.body || "{}"));
    if (init?.method === "PUT") { draft = body.draft; return Response.json({ saved:true }); }
    if (init?.method === "DELETE") { draft = null; return Response.json({ discarded:true }); }
    if (body.action === "start") { starts++; draft ??= createCollectionDraft({ ...preparation, appointment: { ...appointment, id:body.appointmentId } }, crypto.randomUUID(), new Date().toISOString()); draft.context=body.contextCategory; return Response.json({ draft }); }
    if (body.action === "close") { draft=null; return Response.json({receipt:{id:body.payload.id}}); }
    if (fail) { fail=false; return Response.json({error:"Fallo de carga simulado"},{status:503}); }
    if (params.has("noAppointment")) return Response.json({error:"No tienes una cita disponible para hoy con este niño. Revisa su asignación con coordinación."},{status:409});
    if (params.has("multiple") && !query.has("appointmentId")) return Response.json({preparation:null,draft:null,appointments:[{id:appointment.id,startTime:"09:00",endTime:"10:00",sessionType:"Terapia individual",inProgress:false},{id:"qa-second",startTime:"11:00",endTime:"12:00",sessionType:"Terapia individual",inProgress:true}]});
    return Response.json({preparation:{...preparation,appointment:{...appointment,id:query.get("appointmentId") || appointment.id}},draft});
  }
  throw new Error(`Fixture ausente: ${url}`);
};
function Harness() {
  const [scopeSite, setScopeSite] = useState("Todas");
  const [scopeMode, setScopeMode] = useState("calendar");
  const [history, setHistory] = useState(false);
  const [selected, setSelected] = useState(params.has("dossier") ? profile.id : "all");
  const [entry, setEntry] = useState<{profileId:string;profileName:string;appointmentId?:string}|null>(null);
  const [notice,setNotice] = useState("");
  const start = params.has("readonly") ? undefined : () => setEntry({profileId:profile.id,profileName:profile.fullName});
  return <><main className="formation-content"><h1>Prueba aislada · Datos ficticios</h1>
    {params.has("encounters") && history ? <><button onClick={()=>setHistory(false)}>Volver al expediente QA</button><InterventionSessionManager mode="sessions" historyOnly cycles={[]} profiles={[entryProfile]} selectedProfileId={profile.id} selectedSite={profile.site} onSelectProfile={setSelected} onProfilesRefresh={()=>undefined} notify={setNotice} canManagePrograms={false} canRecordSessions={false} canManageSessions={false}/></> : params.has("scope") ? <>
      <ClinicalScopeControls profiles={scopeProfiles} sites={[...new Set(fixtureSites)]} filter={{site:scopeSite,profileId:selected}} onSiteChange={site=>{setScopeSite(site); if (site!=="Todas" && scopeProfiles.find(p=>p.id===selected)?.site!==site) setSelected("all");}} onProfileChange={id=>{setSelected(id);const child=scopeProfiles.find(p=>p.id===id);if(child)setScopeSite(child.site);}} onClear={()=>{setScopeSite("Todas");setSelected("all");}}/>
      <button onClick={()=>setScopeMode("calendar")}>Calendario principal QA</button><button onClick={()=>setScopeMode("home")}>Inicio QA</button><button onClick={()=>setScopeMode("children")}>Directorio QA</button>
      {scopeMode==="children" ? <PersonnelProfileManager profiles={scopeProfiles} sites={[...new Set(fixtureSites)]} selectedSite={scopeSite} onSelectSite={setScopeSite} linkableAccounts={[]} canManage={false} selectedProfileId={selected} onSelect={setSelected} onProfilesChange={()=>undefined} onOpenPrograms={()=>undefined} onOpenEvaluations={()=>undefined} onOpenSessions={()=>undefined} onOpenGraphs={()=>undefined} onOpenProgramGraph={()=>undefined} onOpenABC={()=>undefined} onOpenReports={()=>undefined} notify={setNotice}/> : <CalendarManager profiles={scopeProfiles} selectedSite={scopeSite} selectedProfileId={selected} compact={scopeMode==="home"} notify={setNotice} onOpenSession={()=>undefined}/>}
    </> : params.has("home") ? <CalendarManager compact profiles={[entryProfile]} notify={setNotice} onOpenSession={(item)=>setEntry({profileId:item.profileId,profileName:item.profileName,appointmentId:item.id})}/> : <PersonnelProfileManager profiles={[entryProfile]} sites={["León"]} linkableAccounts={[]} canManage={false} selectedProfileId={selected} onSelect={setSelected} onProfilesChange={()=>undefined} onOpenPrograms={()=>undefined} onOpenEvaluations={()=>undefined} onOpenSessions={()=>params.has("encounters") ? setHistory(true) : setNotice("Historial completo")} onOpenGraphs={()=>undefined} onOpenProgramGraph={()=>undefined} onOpenABC={()=>undefined} onOpenReports={()=>undefined} onStartTodaySession={start} notify={setNotice}/>}
    <button onClick={()=>setNotice(`Inicios: ${starts}; guardado: ${lastProgrammed}; peticiones: ${requests.join(" | ")}`)}>Inspeccionar peticiones</button>
  </main>{entry && <TodaySessionLauncher {...entry} onExit={()=>setEntry(null)} onFinished={()=>undefined} notify={setNotice}/>}<ToastNotice message={notice}/></>;
}
createRoot(document.getElementById("root")!).render(<Harness/>);
