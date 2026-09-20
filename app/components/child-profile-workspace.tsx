"use client";

import { clientRequest } from "../../lib/client-request";
import { StartTodaySessionButton } from "./today-session-launcher";
import { summarizeClosedSessions } from "../../lib/clinical-session-runs";

import {
  Activity,
  ArrowLeft,
  BarChart3,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Download,
  Edit3,
  FileArchive,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  ListTree,
  Languages,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  Phone,
  Plus,
  ShieldCheck,
  Stethoscope,
  Trash2,
  Upload,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { roleLabel, type AppRole } from "../../lib/access-control";
import ProfilePhoto, { uploadProfilePhoto } from "./profile-photo";

type CustomField = { id: string; label: string; value: string };
type Profile = {
  id: string;
  fullName: string;
  site: string;
  internalCode: string;
  dateOfBirth: string;
  diagnosis: string;
  address: string;
  phone: string;
  guardianName: string;
  guardianPhone: string;
  preferredLanguage: string;
  emergencyContact: string;
  customFields: CustomField[];
  notes: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  photoUrl?: string | null;
  responsibles?: Array<{ id: string; displayName: string; role: AppRole }>;
};

type Evaluation = { id: string; programContext: string; cycleLabel: string; instrumentVersion: string; routeType: string; status: string; archivedAt: string | null; updatedAt: string };
type Target = { id: string; code: string; name: string; specificObjective: string; state: string; measurement: string; unitLabel: string; lastSampledDate?: string | null; maintenanceDue?: boolean; maintenanceDueDate?: string | null };
type Program = { id: string; name: string; objective: string; instructions: string; status: string; updatedAt: string; targets: Target[]; graphConfig?: { graphType?: string; designType?: string; primaryTargetId?: string | null } };
type TargetTransition = { targetId: string; code: string; targetName: string; from: string; to: string; reason: string };
type Session = { id: string; clinicalSessionRunId?: string | null; programId: string; programName: string; sessionDate: string; context: string; notes: string; status: string; results: unknown[]; transitions?: TargetTransition[]; professionalName?: string; durationMinutes?: number | null };
type Graph = { id: string; title: string; objective: string; graphType: string; designType: string; measurement: string; status: string; pointCount: number; updatedAt: string; linkedProgramId: string | null; programName: string };
type Report = { id: string; title: string; reportType: string; status: "draft" | "finalized"; authorName: string; finalizedAt: string | null; updatedAt: string };
type Document = { id: string; fileName: string; contentType: string; sizeBytes: number; description: string; createdAt: string };
type ABCRecord = { id: string; eventDate: string; eventTime: string; antecedentLabel: string; behaviorLabel: string; consequenceLabel: string; recordedByName: string };
type Capabilities = { evaluations: boolean; programs: boolean; sessions: boolean; graphs: boolean; reports: boolean; abc: boolean; manageChild: boolean };
type Dossier = { profile: Profile; evaluations: Evaluation[]; programs: Program[]; sessions: Session[]; graphs: Graph[]; reports: Report[]; abcRecords: ABCRecord[]; documents: Document[]; capabilities: Capabilities };
type SectionKey = "overview" | "general" | "evaluations" | "programs" | "sessions" | "graphs" | "abc" | "reports" | "documents" | "service-plan";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "NI";
}

function formatDate(value: string) {
  if (!value) return "No registrado";
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("es-NI", { day: "numeric", month: "short", year: "numeric" });
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ageFrom(dateOfBirth: string) {
  if (!dateOfBirth) return null;
  const birth = new Date(`${dateOfBirth}T12:00:00`);
  if (Number.isNaN(birth.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  if (today.getMonth() < birth.getMonth() || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

function statusLabel(value: string) {
  return ({ active: "Activo", archived: "Archivado", draft: "Borrador", closed: "Cerrada", initial: "Inicial", teaching: "En enseñanza", reevaluation: "Reevaluación", complete: "Completada", baseline: "Línea base", intervention: "Intervención", acquisition: "Adquisición", generalization: "Masterizado", maintenance: "Generalizado", mastered: "Masterizado", generalized: "Generalizado", paused: "Pausado" } as Record<string, string>)[value] || value;
}

function targetPhaseLabel(value: string) {
  return ({ baseline: "Línea base", acquisition: "Adquisición", generalization: "Masterizado", maintenance: "Generalizado", closed: "Cerrado" } as Record<string, string>)[value] || value;
}

function documentIcon(contentType: string) {
  if (contentType.includes("spreadsheet") || contentType.includes("excel") || contentType === "text/csv") return FileSpreadsheet;
  if (contentType.includes("word")) return FileText;
  return FileArchive;
}

function Detail({ icon: Icon, label, value }: { icon: ComponentType<{ size?: number }>; label: string; value?: string | null }) {
  return <div className="child-detail"><span><Icon size={17}/></span><div><small>{label}</small><strong className={!value ? "is-empty" : ""}>{value || "No registrado"}</strong></div></div>;
}

export default function ChildProfileWorkspace({
  profile,
  canManage,
  onBack,
  onEdit,
  onOpenEvaluations,
  onOpenPrograms,
  onOpenSessions,
  onStartTodaySession,
  onOpenGraphs,
  onOpenProgramGraph,
  onOpenABC,
  onOpenReports,
  onPhotoChange,
  notify,
}: {
  profile: Profile;
  canManage: boolean;
  onBack: () => void;
  onEdit: () => void;
  onOpenEvaluations: () => void;
  onOpenPrograms: () => void;
  onOpenSessions: () => void;
  onStartTodaySession?: (profileId: string) => void;
  onOpenGraphs: () => void;
  onOpenProgramGraph: (programId: string) => void;
  onOpenABC: () => void;
  onOpenReports: () => void;
  onPhotoChange: (photoUrl: string | null) => void;
  notify: (message: string) => void;
}) {
  const [data, setData] = useState<Dossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reloadRevision, setReloadRevision] = useState(0);
  const [section, setSection] = useState<SectionKey>("overview");
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [fileInputKey, setFileInputKey] = useState(0);
  const [photoUploading, setPhotoUploading] = useState(false);

  const loadDossier = useCallback(async () => {
    try {
      const response = await clientRequest(`/api/child-profile?profileId=${encodeURIComponent(profile.id)}`, { cache: "no-store" });
      const payload = await response.json() as Dossier & { error?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudo cargar el expediente.");
      payload.profile.responsibles = profile.responsibles;
      setData(payload);
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo cargar el expediente.");
    } finally { setLoading(false); }
  }, [notify, profile.id, profile.responsibles]);

  useEffect(() => {
    const controller = new AbortController();
    // Never show the previous child's dossier while a new identity is loading.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true); setData(null); setLoadError("");
    clientRequest(`/api/child-profile?profileId=${encodeURIComponent(profile.id)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json() as Dossier & { error?: string };
        if (!response.ok) throw new Error(payload.error || "No se pudo cargar el expediente.");
        payload.profile.responsibles = profile.responsibles;
        return payload;
      })
      .then((payload) => { if (!controller.signal.aborted) setData(payload); })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) { const message = error instanceof Error ? error.message : "No se pudo cargar el expediente."; setLoadError(message); notify(message); }
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [notify, profile.id, profile.responsibles, profile.updatedAt, reloadRevision]);

  const child = data?.profile || profile;
  const age = ageFrom(child.dateOfBirth);
  const sessionSummary = useMemo(() => summarizeClosedSessions(data?.sessions || []), [data]);
  const recentCriterionTransitions = useMemo(() => {
    const seen = new Set<string>();
    return (data?.sessions || []).flatMap((session) => (session.transitions || []).map((transition) => ({ ...transition, sessionDate: session.sessionDate, programName: session.programName })))
      .filter((transition) => transition.to !== "acquisition" && !seen.has(transition.targetId) && Boolean(seen.add(transition.targetId)))
      .slice(0, 5);
  }, [data]);
  const maintenanceDueTargets = useMemo(() => (data?.programs || []).filter((program) => program.status === "active").flatMap((program) => program.targets
    .filter((target) => target.state === "maintenance" && target.maintenanceDue === true)
    .map((target) => ({ ...target, programName: program.name }))), [data]);

  const permitted = (key: SectionKey) => {
    if (!data || key === "overview" || key === "general" || key === "documents") return true;
    if (key === "service-plan") return data.capabilities.programs;
    return data.capabilities[key];
  };

  const modules: Array<{ key: Exclude<SectionKey, "overview">; label: string; shortLabel: string }> = [
    { key: "general", label: "Datos generales", shortLabel: "Datos" },
    { key: "evaluations", label: "Evaluaciones", shortLabel: "Evaluación" },
    { key: "programs", label: "Programas", shortLabel: "Programas" },
    { key: "sessions", label: "Sesiones", shortLabel: "Sesiones" },
    { key: "graphs", label: "Gráficas", shortLabel: "Gráficas" },
    { key: "abc", label: "Registro ABC", shortLabel: "ABC" },
    { key: "reports", label: "Informes", shortLabel: "Informes" },
    { key: "documents", label: "Documentos", shortLabel: "Archivos" },
    { key: "service-plan", label: "Plan de servicio", shortLabel: "Plan" },
  ];

  async function uploadDocument() {
    if (!file) return notify("Selecciona un documento.");
    setUploading(true);
    try {
      const form = new FormData();
      form.set("profileId", profile.id);
      form.set("file", file);
      form.set("description", description);
      const response = await clientRequest("/api/child-documents", { method: "POST", body: form });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudo subir el documento.");
      setFile(null);
      setDescription("");
      setFileInputKey((value) => value + 1);
      await loadDossier();
      setSection("documents");
      notify("Documento añadido al expediente.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo subir el documento.");
    } finally { setUploading(false); }
  }

  async function deleteDocument(document: Document) {
    if (!window.confirm(`¿Eliminar ${document.fileName} del expediente?`)) return;
    try {
      const response = await clientRequest("/api/child-documents", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: document.id }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudo eliminar el documento.");
      await loadDossier();
      setSection("documents");
      notify("Documento eliminado.");
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo eliminar el documento."); }
  }

  async function changePhoto(file: File) {
    setPhotoUploading(true);
    try {
      const photoUrl = await uploadProfilePhoto("child", profile.id, file);
      setData((current) => current ? { ...current, profile: { ...current.profile, photoUrl } } : current);
      onPhotoChange(photoUrl);
      notify("Fotografía del niño actualizada.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo guardar la fotografía.");
    } finally { setPhotoUploading(false); }
  }

  function EmptySection({ title, text }: { title: string; text: string }) {
    return <div className="child-section-empty"><FolderOpen size={28}/><strong>{title}</strong><p>{text}</p></div>;
  }

  function renderSection() {
    if (!data) return null;
    if (section === "overview") return <div className="child-overview-dashboard">
      <header className="child-overview-heading"><div><p className="section-kicker">Resumen clínico</p><h2>Qué requiere atención</h2></div><span>{sessionSummary.sessionCount} sesión{sessionSummary.sessionCount === 1 ? "" : "es"} cerrada{sessionSummary.sessionCount === 1 ? "" : "s"}</span></header>
      <section className="child-today-action"><span><CalendarDays size={24}/></span><div><strong>Sesión de hoy</strong><p>{profile.status === "active" ? "Prepara la cita disponible y comienza la toma sin pasar por el calendario." : "El expediente está archivado y no admite nuevas sesiones."}</p></div><div>{profile.status === "active" && onStartTodaySession ? <StartTodaySessionButton onClick={() => onStartTodaySession(profile.id)}/> : <button className="secondary-formation-button" onClick={() => setSection("sessions")}>Ver sesiones</button>}</div></section>
      <div className="child-overview-panels">
        <section className="child-action-panel"><header><span className="criterion"><CheckCircle2 size={18}/></span><div><strong>Targets que alcanzaron criterio</strong><small>Cambios de fase recientes</small></div><em>{recentCriterionTransitions.length}</em></header>{recentCriterionTransitions.length ? <div className="child-action-list">{recentCriterionTransitions.map((transition) => <article key={`${transition.targetId}:${transition.sessionDate}`}><div><strong>{transition.code} · {transition.targetName}</strong><small>{transition.programName} · {formatDate(transition.sessionDate)}</small></div><span>{targetPhaseLabel(transition.to)}</span></article>)}</div> : <p className="child-action-empty">No hay cambios de fase recientes.</p>}<button className="child-panel-link" onClick={onOpenPrograms}>Abrir programas <ChevronRight size={15}/></button></section>
        <section className="child-action-panel"><header><span className="maintenance"><Activity size={18}/></span><div><strong>Sondas de mantenimiento</strong><small>Generalización que ya debe comprobarse</small></div><em>{maintenanceDueTargets.length}</em></header>{maintenanceDueTargets.length ? <div className="child-action-list">{maintenanceDueTargets.map((target) => <article key={target.id}><div><strong>{target.code} · {target.name}</strong><small>{target.programName}</small></div><span>{target.maintenanceDueDate ? `Pendiente desde ${formatDate(target.maintenanceDueDate)}` : "Primera sonda pendiente"}</span></article>)}</div> : <p className="child-action-empty">No hay sondas pendientes.</p>}<button className="child-panel-link" onClick={onOpenPrograms}>Revisar programas <ChevronRight size={15}/></button></section>
      </div>
    </div>;

    if (!permitted(section)) return <EmptySection title="Acceso restringido" text="El rol de esta cuenta no permite consultar este apartado."/>;

    if (section === "general") return <div className="child-general-layout">
      <section className="child-section-card"><header><div><p className="section-kicker">Información personal</p><h2>Datos generales</h2></div>{canManage && <button className="secondary-formation-button" onClick={onEdit}><Edit3 size={15}/> Editar</button>}</header><div className="child-detail-grid">
        <Detail icon={UserRound} label="Nombre completo" value={child.fullName}/><Detail icon={Activity} label="Código interno" value={child.internalCode}/>
        <Detail icon={CalendarDays} label="Fecha de nacimiento" value={child.dateOfBirth ? `${formatDate(child.dateOfBirth)}${age !== null ? ` · ${age} años` : ""}` : ""}/><Detail icon={Stethoscope} label="Diagnóstico" value={child.diagnosis}/>
        <Detail icon={MapPin} label="Dirección" value={child.address}/><Detail icon={Phone} label="Teléfono" value={child.phone}/>
        <Detail icon={Languages} label="Idioma preferido" value={child.preferredLanguage}/><Detail icon={MapPin} label="Sede" value={child.site}/>
      </div>{child.customFields?.length > 0 && <div className="child-custom-details">{child.customFields.map((field) => <div key={field.id}><small>{field.label}</small><strong>{field.value || "No registrado"}</strong></div>)}</div>}
      </section>
      <section className="child-section-card"><header><div><p className="section-kicker">Red de apoyo</p><h2>Familia y responsables</h2></div></header><div className="child-detail-grid">
        <Detail icon={UsersRound} label="Madre, padre o tutor" value={child.guardianName}/><Detail icon={Phone} label="Teléfono del tutor" value={child.guardianPhone}/><Detail icon={ShieldCheck} label="Contacto de emergencia" value={child.emergencyContact}/>
      </div><div className="child-clinical-team">{(child.responsibles || []).length ? child.responsibles?.map((responsible) => <div key={responsible.id}><span>{initials(responsible.displayName)}</span><div><small>{roleLabel(responsible.role)}</small><strong>{responsible.displayName}</strong></div></div>) : <p>No hay responsables clínicos vinculados.</p>}</div>{child.notes && <div className="child-note"><strong>Nota administrativa</strong><p>{child.notes}</p></div>}</section>
    </div>;

    if (section === "evaluations") return <section className="child-section-card"><header><div><p className="section-kicker">Historia evaluativa</p><h2>Evaluaciones</h2></div><button className="primary-formation-button" onClick={onOpenEvaluations}>Abrir módulo</button></header>{data.evaluations.length ? <div className="child-record-list">{data.evaluations.map((evaluation) => <article key={evaluation.id}><span className="record-symbol"><ClipboardList size={19}/></span><div><strong>{evaluation.programContext}</strong><p>{evaluation.cycleLabel} · {evaluation.instrumentVersion} · Ruta {evaluation.routeType}</p></div><span className={`child-status ${evaluation.archivedAt ? "archived" : ""}`}>{evaluation.archivedAt ? "Archivada" : statusLabel(evaluation.status)}</span><small>{formatDate(evaluation.updatedAt)}</small></article>)}</div> : <EmptySection title="Sin evaluaciones" text="Las evaluaciones vinculadas a este niño aparecerán aquí."/>}</section>;

    if (section === "programs") return <section className="child-section-card"><header><div><p className="section-kicker">Intervención</p><h2>Programas</h2></div><button className="primary-formation-button" onClick={onOpenPrograms}>Gestionar programas</button></header>{data.programs.length ? <div className="child-program-list">{data.programs.map((program) => <article key={program.id}><div><span><BookOpenCheck size={19}/></span><div><strong>{program.name}</strong><p>{program.objective}</p></div></div><footer><span className="child-status">{statusLabel(program.status)}</span><small>{program.targets.length} objetivo{program.targets.length === 1 ? "" : "s"} específico{program.targets.length === 1 ? "" : "s"}</small><small>{program.graphConfig?.graphType === "cumulative" ? "Acumulativa" : program.graphConfig?.graphType === "bar" ? "Barras" : "Línea"} · por programa</small><button className="child-inline-action" onClick={() => onOpenProgramGraph(program.id)}><BarChart3 size={15}/> Ver gráfica</button></footer></article>)}</div> : <EmptySection title="Sin programas" text="Crea o vincula un programa para comenzar el plan de intervención."/>}</section>;

    if (section === "sessions") return <section className="child-section-card"><header><div><p className="section-kicker">Atención e historial</p><h2>Sesiones</h2><p className="clinical-session-counts">Encuentros cerrados: {sessionSummary.sessionCount} · Registros por programa: {sessionSummary.programRecordCount}</p></div><div className="child-session-actions">{profile.status === "active" && onStartTodaySession && <StartTodaySessionButton onClick={() => onStartTodaySession(profile.id)}/>}<button className="secondary-formation-button" onClick={onOpenSessions}>Ver historial completo</button></div></header>{sessionSummary.groups.length ? <div className="child-record-list">{sessionSummary.groups.map((group) => {
      const session = group.rows[0];
      return <article className="child-session-encounter" key={group.id}><span className="record-symbol"><CalendarDays size={19}/></span><div><strong>Sesión cerrada</strong><p>{session.professionalName || "Profesional no registrado"}{session.durationMinutes ? ` · ${session.durationMinutes} min` : ""}{session.context ? ` · ${session.context}` : ""}</p></div><span className="child-status">Cerrada</span><small>{formatDate(session.sessionDate)}</small><details className="child-session-programs"><summary>{group.rows.length} registro{group.rows.length === 1 ? "" : "s"} por programa</summary>{group.rows.map((record) => <div key={record.id}><strong>{record.programName}</strong>{record.notes && <p>{record.notes}</p>}</div>)}</details></article>;
    })}</div> : <EmptySection title="Sin sesiones finalizadas" text="Las sesiones cerradas de este niño aparecerán aquí como historial clínico."/>}</section>;

    if (section === "graphs") return <section className="child-section-card"><header><div><p className="section-kicker">Visualización clínica</p><h2>Gráficas por programa</h2><p>La portada de cada programa usa sus sesiones y eventos de dominio; los targets permanecen en una vista secundaria.</p></div><button className="primary-formation-button" onClick={onOpenGraphs}>Abrir gráficas</button></header>{data.programs.length > 0 && <div className="program-graph-shortcuts">{data.programs.map((program) => <button key={program.id} onClick={() => onOpenProgramGraph(program.id)}><BarChart3 size={18}/><span><strong>{program.name}</strong><small>{program.graphConfig?.graphType === "cumulative" ? "Acumulativa" : program.graphConfig?.graphType === "bar" ? "Barras" : "Línea"} · programa completo</small></span><ChevronRight size={16}/></button>)}</div>}{data.capabilities.abc && <button className="child-inline-action" onClick={onOpenABC}><ListTree size={15}/> Abrir análisis ABC</button>}{data.graphs.length ? <div className="child-record-list">{data.graphs.map((graph) => <article key={graph.id}><span className="record-symbol"><BarChart3 size={19}/></span><div><strong>{graph.title}</strong><p>{graph.designType} · {graph.measurement} · {graph.pointCount} puntos{graph.programName ? ` · ${graph.programName}` : ""}</p></div><span className="child-status">{statusLabel(graph.status)}</span><small>{formatDate(graph.updatedAt)}</small></article>)}</div> : data.programs.length === 0 && <EmptySection title="Sin gráficas vinculadas" text="Las gráficas se mostrarán cuando el niño tenga programas o visualizaciones manuales vinculadas."/>}</section>;

    if (section === "abc") return <section className="child-section-card"><header><div><p className="section-kicker">Observación descriptiva</p><h2>Registro ABC</h2><p>Antecedente, conducta y consecuencia documentados sin inferir automáticamente la función conductual.</p></div><button className="primary-formation-button" onClick={onOpenABC}><Plus size={16}/> Registrar o analizar ABC</button></header>{data.abcRecords.length ? <div className="child-record-list">{data.abcRecords.map((record) => <article key={record.id}><span className="record-symbol"><ListTree size={19}/></span><div><strong>{record.behaviorLabel}</strong><p>{record.antecedentLabel} → {record.consequenceLabel} · {record.recordedByName}</p></div><span className="child-status">ABC</span><small>{formatDate(record.eventDate)} · {record.eventTime}</small></article>)}</div> : <EmptySection title="Sin registros ABC" text="Los episodios descriptivos registrados para este niño aparecerán aquí."/>}</section>;

    if (section === "reports") return <section className="child-section-card"><header><div><p className="section-kicker">Historia documental</p><h2>Informes</h2><p>Borradores y documentos finalizados vinculados a este expediente.</p></div><button className="primary-formation-button" onClick={onOpenReports}>Abrir módulo</button></header>{data.reports.length ? <div className="child-record-list">{data.reports.map((report) => <article key={report.id}><span className="record-symbol"><FileText size={19}/></span><div><strong>{report.title}</strong><p>{report.reportType} · {report.authorName}</p></div><span className={`child-status ${report.status === "finalized" ? "" : "archived"}`}>{report.status === "finalized" ? "Finalizado" : "Borrador"}</span><small>{formatDate(report.finalizedAt || report.updatedAt)}</small></article>)}</div> : <EmptySection title="Sin informes" text="Los informes creados para este niño aparecerán aquí con su estado y autor."/>}</section>;

    if (section === "documents") return <div className="child-documents-layout">
      {data.capabilities.manageChild && <section className="child-upload-card"><div><span><Upload size={21}/></span><div><p className="section-kicker">Archivo clínico</p><h2>Añadir documento</h2><p>PDF, Word, Excel o CSV · máximo 15 MB.</p></div></div><label><span>Archivo</span><input key={fileInputKey} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv" onChange={(event) => setFile(event.target.files?.[0] || null)}/></label><label><span>Descripción (opcional)</span><input value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} placeholder="Ej. Informe diagnóstico de agosto"/></label><button className="primary-formation-button" disabled={!file || uploading} onClick={uploadDocument}>{uploading ? <LoaderCircle className="spin" size={16}/> : <Plus size={16}/>} Subir al expediente</button></section>}
      <section className="child-section-card"><header><div><p className="section-kicker">Repositorio privado</p><h2>Documentos</h2></div><span>{data.documents.length} archivo{data.documents.length === 1 ? "" : "s"}</span></header>{data.documents.length ? <div className="child-document-list">{data.documents.map((document) => { const Icon = documentIcon(document.contentType); return <article key={document.id}><span><Icon size={20}/></span><div><strong>{document.fileName}</strong><p>{document.description || "Sin descripción"}</p><small>{formatSize(document.sizeBytes)} · {formatDate(document.createdAt)}</small></div><a href={`/api/child-documents?id=${encodeURIComponent(document.id)}`} aria-label={`Descargar ${document.fileName}`}><Download size={17}/></a>{data.capabilities.manageChild && <button className="danger-action" aria-label={`Eliminar ${document.fileName}`} onClick={() => deleteDocument(document)}><Trash2 size={16}/></button>}</article>; })}</div> : <EmptySection title="Sin documentos" text="Los archivos clínicos de este niño quedarán reunidos aquí."/>}</section>
    </div>;

    return <section className="child-section-card service-plan"><header><div><p className="section-kicker">Plan de servicio</p><h2>Programas y objetivos del niño</h2><p>Esta vista se alimenta automáticamente de los programas vinculados al expediente.</p></div><button className="primary-formation-button" onClick={onOpenPrograms}>Gestionar programas</button></header>{data.programs.length ? <div className="service-programs">{data.programs.map((program, index) => <article key={program.id}><header><span>{String(index + 1).padStart(2, "0")}</span><div><small>{statusLabel(program.status)}</small><h3>{program.name}</h3><p>{program.objective}</p></div></header>{program.instructions && <div className="service-instructions"><strong>Procedimiento</strong><p>{program.instructions}</p></div>}<div className="service-targets">{program.targets.length ? program.targets.map((target) => <div key={target.id}><span>{target.code}</span><div><strong>{target.name}</strong><p>{target.specificObjective}</p></div><em>{statusLabel(target.state)}</em></div>) : <p className="no-targets">Este programa todavía no tiene objetivos específicos.</p>}</div></article>)}</div> : <EmptySection title="Plan de servicio pendiente" text="Los programas del niño aparecerán aquí como su plan de servicio integrado."/>}</section>;
  }

  if (loadError) return <div className="load-error" role="alert"><p>{loadError}</p><button onClick={() => setReloadRevision(current => current + 1)}>Reintentar carga</button><button onClick={onBack}>Volver a niños</button></div>;
  return <div className="child-dossier">
    <div className="child-dossier-header">
      <section className="child-identity-card"><button className="child-identity-back" aria-label="Volver al directorio de niños" onClick={onBack}><ArrowLeft size={18}/><span>Niños</span></button><ProfilePhoto name={child.fullName} src={child.photoUrl} avatarClassName="child-avatar" editable={canManage} uploading={photoUploading} onFile={changePhoto}/><div className="child-identity-copy"><h1>{child.fullName}</h1><p><MapPin size={14}/> Sede {child.site}{child.internalCode ? ` · ${child.internalCode}` : ""}</p><div><span className={`child-status ${child.status === "archived" ? "archived" : ""}`}><CheckCircle2 size={13}/> {statusLabel(child.status)}</span>{age !== null && <span><CalendarDays size={13}/> {age} años</span>}{child.diagnosis && <span className="child-diagnosis"><Stethoscope size={13}/> {child.diagnosis}</span>}</div></div>{canManage && <div className="child-identity-actions"><button className="secondary-formation-button" onClick={onEdit}><Edit3 size={15}/><span>Editar datos</span></button></div>}</section>
      <nav className="child-section-nav" aria-label="Apartados del expediente"><button aria-current={section === "overview" ? "page" : undefined} className={section === "overview" ? "active" : ""} onClick={() => setSection("overview")}>Resumen</button>{modules.map((module) => <button key={module.key} aria-label={module.label} aria-current={section === module.key ? "page" : undefined} className={section === module.key ? "active" : ""} disabled={!permitted(module.key)} onClick={() => setSection(module.key)}><span className="child-nav-full">{module.label}</span><span className="child-nav-short" aria-hidden="true">{module.shortLabel}</span>{!permitted(module.key) && <LockKeyhole size={12}/>}</button>)}</nav>
    </div>
    {loading ? <div className="child-dossier-loading"><LoaderCircle className="spin" size={28}/><strong>Cargando expediente…</strong></div> : renderSection()}
  </div>;
}
