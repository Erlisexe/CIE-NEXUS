"use client";

import { clientRequest } from "../../lib/client-request";
import { StartTodaySessionButton } from "./today-session-launcher";

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
type Target = { id: string; code: string; name: string; specificObjective: string; state: string; measurement: string; unitLabel: string };
type Program = { id: string; name: string; objective: string; instructions: string; status: string; updatedAt: string; targets: Target[]; graphConfig?: { graphType?: string; designType?: string; primaryTargetId?: string | null } };
type Session = { id: string; programId: string; programName: string; sessionDate: string; context: string; notes: string; status: string; results: unknown[]; professionalName?: string; durationMinutes?: number | null };
type Graph = { id: string; title: string; objective: string; graphType: string; designType: string; measurement: string; status: string; pointCount: number; updatedAt: string; linkedProgramId: string | null; programName: string };
type Report = { id: string; title: string; reportType: string; status: "draft" | "finalized"; authorName: string; finalizedAt: string | null; updatedAt: string };
type Document = { id: string; fileName: string; contentType: string; sizeBytes: number; description: string; createdAt: string };
type ABCRecord = { id: string; eventDate: string; eventTime: string; antecedentLabel: string; behaviorLabel: string; consequenceLabel: string; recordedByName: string };
type Capabilities = { evaluations: boolean; programs: boolean; sessions: boolean; graphs: boolean; reports: boolean; abc: boolean; manageChild: boolean };
type Dossier = { profile: Profile; evaluations: Evaluation[]; programs: Program[]; sessions: Session[]; graphs: Graph[]; reports: Report[]; abcRecords: ABCRecord[]; documents: Document[]; capabilities: Capabilities };
type SectionKey = "overview" | "general" | "evaluations" | "programs" | "sessions" | "graphs" | "abc" | "reports" | "documents" | "service-plan";

const SECTION_LABELS: Record<SectionKey, string> = {
  overview: "Resumen",
  general: "Datos generales",
  evaluations: "Evaluaciones",
  programs: "Programas",
  sessions: "Sesiones",
  graphs: "Gráficas",
  abc: "Registro ABC",
  reports: "Informes",
  documents: "Documentos",
  "service-plan": "Plan de servicio",
};

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
  const counts = useMemo(() => ({
    evaluations: data?.evaluations.length || 0,
    programs: data?.programs.length || 0,
    sessions: data?.sessions.length || 0,
    graphs: data?.graphs.length || 0,
    abc: data?.abcRecords.length || 0,
    reports: data?.reports.length || 0,
    documents: data?.documents.length || 0,
    "service-plan": data?.programs.filter((program) => program.status === "active").length || 0,
  }), [data]);

  const permitted = (key: SectionKey) => {
    if (!data || key === "overview" || key === "general" || key === "documents") return true;
    if (key === "service-plan") return data.capabilities.programs;
    return data.capabilities[key];
  };

  const modules: Array<{ key: Exclude<SectionKey, "overview">; label: string; description: string; Icon: ComponentType<{ size?: number }> }> = [
    { key: "general", label: "Datos generales", description: "Identificación, contacto y responsables", Icon: UserRound },
    { key: "evaluations", label: "Evaluaciones", description: "Líneas base, progreso y reevaluaciones", Icon: ClipboardList },
    { key: "programs", label: "Programas", description: "Intervenciones y objetivos activos", Icon: BookOpenCheck },
    { key: "sessions", label: "Sesiones", description: "Registro cronológico de atención", Icon: CalendarDays },
    { key: "graphs", label: "Gráficas", description: "Evolución visual de los datos", Icon: BarChart3 },
    { key: "abc", label: "Registro ABC", description: "Observaciones descriptivas A-B-C", Icon: ListTree },
    { key: "reports", label: "Informes", description: "Borradores y documentos finalizados", Icon: FileText },
    { key: "documents", label: "Documentos", description: "PDF, Word, Excel y CSV", Icon: FolderOpen },
    { key: "service-plan", label: "Plan de servicio", description: "Vista integrada de programas y targets", Icon: ShieldCheck },
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
    if (section === "overview") return <div className="child-module-grid">{modules.map(({ key, label, description: text, Icon }) => {
      const access = permitted(key);
      const count = key === "general" ? undefined : counts[key as keyof typeof counts];
      return <button className={`child-module-card module-${key} ${!access ? "restricted" : ""}`} key={key} disabled={!access} onClick={() => setSection(key)}>
        <span className="child-module-icon"><Icon size={24}/></span><span><strong>{label}</strong><small>{access ? text : "Sin permiso para consultar"}</small></span>{access ? <em>{typeof count === "number" ? count : "Abrir"}</em> : <LockKeyhole size={16}/>} 
      </button>;
    })}</div>;

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

    if (section === "sessions") return <section className="child-section-card"><header><div><p className="section-kicker">Atención e historial</p><h2>Sesiones</h2></div><div className="child-session-actions">{profile.status === "active" && onStartTodaySession && <StartTodaySessionButton onClick={() => onStartTodaySession(profile.id)}/>}<button className="secondary-formation-button" onClick={onOpenSessions}>Ver historial completo</button></div></header>{data.sessions.length ? <div className="child-record-list">{data.sessions.map((session) => <article key={session.id}><span className="record-symbol"><CalendarDays size={19}/></span><div><strong>{session.programName}</strong><p>{session.professionalName || "Profesional no registrado"}{session.durationMinutes ? ` · ${session.durationMinutes} min` : ""}{session.context ? ` · ${session.context}` : ""}{session.notes ? ` · ${session.notes}` : ""}</p></div><span className="child-status">{statusLabel(session.status)}</span><small>{formatDate(session.sessionDate)}</small></article>)}</div> : <EmptySection title="Sin sesiones finalizadas" text="Las sesiones cerradas de este niño aparecerán aquí como historial clínico."/>}</section>;

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
    <button className="back-button child-back" onClick={onBack}><ArrowLeft size={17}/> Volver al directorio de niños</button>
    <section className="child-identity-card"><ProfilePhoto name={child.fullName} src={child.photoUrl} avatarClassName="child-avatar" editable={canManage} uploading={photoUploading} onFile={changePhoto}/><div className="child-identity-copy"><p className="section-kicker">Expediente infantil</p><h1>{child.fullName}</h1><p><MapPin size={14}/> Sede {child.site}{child.internalCode ? ` · ${child.internalCode}` : ""}</p><div><span className={`child-status ${child.status === "archived" ? "archived" : ""}`}><CheckCircle2 size={13}/> {statusLabel(child.status)}</span>{age !== null && <span><CalendarDays size={13}/> {age} años</span>}{child.diagnosis && <span><Stethoscope size={13}/> {child.diagnosis}</span>}</div></div><div className="child-identity-actions"><small>Expediente centralizado</small>{canManage && <button className="secondary-formation-button" onClick={onEdit}><Edit3 size={15}/> Editar datos</button>}</div></section>

    <nav className="child-section-nav" aria-label="Apartados del expediente"><button className={section === "overview" ? "active" : ""} onClick={() => setSection("overview")}>Resumen</button>{modules.map((module) => <button key={module.key} className={section === module.key ? "active" : ""} disabled={!permitted(module.key)} onClick={() => setSection(module.key)}>{module.label}{!permitted(module.key) && <LockKeyhole size={12}/>}</button>)}</nav>
    <div className="child-section-heading"><div><p className="section-kicker">{child.fullName}</p><h2>{SECTION_LABELS[section]}</h2></div>{section !== "overview" && <button onClick={() => setSection("overview")}>Ver todos los apartados</button>}</div>
    {loading ? <div className="child-dossier-loading"><LoaderCircle className="spin" size={28}/><strong>Cargando expediente…</strong></div> : renderSection()}
  </div>;
}
