"use client";
/* eslint-disable @next/next/no-img-element */

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Copy,
  Eye,
  FilePlus2,
  FileText,
  FolderOpen,
  GripVertical,
  Heading1,
  Layers3,
  LayoutTemplate,
  LoaderCircle,
  Minus,
  Plus,
  Printer,
  Save,
  Search,
  Signature,
  Sparkles,
  Table2,
  Trash2,
  Type,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PersonnelProfile } from "./personnel-profile-manager";
import { GraphCanvas } from "./graph-manager";
import {
  REPORT_VARIABLES,
  replaceReportVariables,
  reportVariableMap,
  type ReportBlock,
  type ReportProfileSnapshot,
  type ReportRecord,
  type ReportSource,
  type ReportTemplate,
} from "../../lib/report-types";

type BuilderReport = {
  id: string | null;
  profileId: string;
  templateId: string | null;
  title: string;
  reportType: string;
  status: "draft" | "finalized";
  blocks: ReportBlock[];
  profileSnapshot: ReportProfileSnapshot | null;
  sourceSelection: string[];
  authorName: string;
};

const PROFILE_FIELD_LABELS = new Map<string, string>(REPORT_VARIABLES.map((item) => [item.key, item.label]));

function localId(prefix = "report") {
  return typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function cloneBlocks(blocks: ReportBlock[]) {
  return blocks.map((block) => ({ ...structuredClone(block), id: localId(block.type) })) as ReportBlock[];
}

function blankBlocks(): ReportBlock[] {
  return [
    { id: localId("cover"), type: "cover", title: "Nuevo informe", subtitle: "{nombre_cliente} · {sede} · {fecha_actual}" },
    { id: localId("profile"), type: "profile_fields", title: "Datos del cliente", fields: ["nombre_cliente", "diagnostico", "edad", "sede", "coordinador", "supervisor"] },
    { id: localId("heading"), type: "heading", level: 1, content: "Resumen" },
    { id: localId("paragraph"), type: "paragraph", content: "Escribe aquí el contenido del informe." },
    { id: localId("signature"), type: "signature", label: "Elaborado por", name: "{autor}", role: "" },
  ];
}

function dateLabel(value: string) {
  if (!value) return "Sin fecha";
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("es-NI", { day: "2-digit", month: "short", year: "numeric" });
}

function statusLabel(status: ReportRecord["status"]) {
  return status === "finalized" ? "Finalizado" : "Borrador";
}

function ReportDocument({
  report,
  brandName,
  logoUrl,
}: {
  report: BuilderReport;
  brandName: string;
  logoUrl: string | null;
}) {
  const profile = report.profileSnapshot;
  const variables = reportVariableMap(profile, report.authorName);
  const fieldValue = (key: string) => variables[key as keyof typeof variables] || "No registrado";

  return <article className="report-document report-print-surface">
    <header className="report-document-brand">
      <div>{logoUrl ? <img src={logoUrl} alt={`Logotipo de ${brandName}`}/> : <span><Sparkles size={24}/></span>}<div><strong>{brandName}</strong><small>Documento clínico y administrativo</small></div></div>
      <div><small>Fecha del documento</small><strong>{variables.fecha_actual}</strong></div>
    </header>
    {report.blocks.map((block) => {
      if (block.type === "cover") return <section className="report-cover" key={block.id}>
        <div>{profile?.photoUrl ? <img src={profile.photoUrl} alt={`Fotografía de ${profile.fullName}`}/> : <span><UserRound size={38}/></span>}</div>
        <p>{report.reportType}</p><h1>{replaceReportVariables(block.title, profile, report.authorName)}</h1><h2>{replaceReportVariables(block.subtitle, profile, report.authorName)}</h2>
      </section>;
      if (block.type === "heading") return block.level === 1
        ? <h2 className="report-heading-one" key={block.id}>{replaceReportVariables(block.content, profile, report.authorName)}</h2>
        : <h3 className="report-heading-two" key={block.id}>{replaceReportVariables(block.content, profile, report.authorName)}</h3>;
      if (block.type === "paragraph") return <p className="report-paragraph" key={block.id}>{replaceReportVariables(block.content, profile, report.authorName)}</p>;
      if (block.type === "profile_fields") return <section className="report-profile-fields" key={block.id}><h2>{replaceReportVariables(block.title, profile, report.authorName)}</h2><div>{block.fields.map((field) => <div key={field}><small>{PROFILE_FIELD_LABELS.get(field) || field}</small><strong>{fieldValue(field)}</strong></div>)}</div></section>;
      if (block.type === "graph") return <figure className="report-graph" key={block.id}><figcaption><strong>{replaceReportVariables(block.title, profile, report.authorName)}</strong>{block.graph.objective && <small>{block.graph.objective}</small>}</figcaption><GraphCanvas graph={block.graph} density="compact" edgeInset/></figure>;
      if (block.type === "table") return <section className="report-table-block" key={block.id}><h2>{replaceReportVariables(block.title, profile, report.authorName)}</h2><div><table><thead><tr>{block.data.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{block.data.rows.map((row, rowIndex) => <tr key={`${block.id}-${rowIndex}`}>{row.map((cell, cellIndex) => <td key={`${block.id}-${rowIndex}-${cellIndex}`}>{cell ?? ""}</td>)}</tr>)}</tbody></table></div></section>;
      if (block.type === "metrics") return <section className="report-metrics" key={block.id}><h2>{replaceReportVariables(block.title, profile, report.authorName)}</h2><div>{block.items.map((item, index) => <div key={`${block.id}-${index}`}><small>{replaceReportVariables(item.label, profile, report.authorName)}</small><strong>{replaceReportVariables(item.value, profile, report.authorName)}</strong></div>)}</div></section>;
      if (block.type === "divider") return <hr className="report-divider" key={block.id}/>;
      return <section className="report-signature" key={block.id}><div/><strong>{replaceReportVariables(block.name, profile, report.authorName)}</strong><span>{replaceReportVariables(block.role, profile, report.authorName)}</span><small>{replaceReportVariables(block.label, profile, report.authorName)}</small></section>;
    })}
    <footer className="report-document-footer"><span>{brandName}</span><span>{report.title}</span><span>{report.status === "finalized" ? "Documento finalizado" : "Vista previa de borrador"}</span></footer>
  </article>;
}

function BlockEditor({
  block,
  index,
  total,
  readonly,
  active,
  onFocus,
  onChange,
  onMove,
  onDelete,
}: {
  block: ReportBlock;
  index: number;
  total: number;
  readonly: boolean;
  active: boolean;
  onFocus: () => void;
  onChange: (block: ReportBlock) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const controls = <div className="report-block-controls"><span><GripVertical size={15}/>{index + 1}</span><button disabled={readonly || index === 0} aria-label="Mover sección hacia arriba" onClick={() => onMove(-1)}><ArrowUp size={14}/></button><button disabled={readonly || index === total - 1} aria-label="Mover sección hacia abajo" onClick={() => onMove(1)}><ArrowDown size={14}/></button><button disabled={readonly} aria-label="Eliminar sección" onClick={onDelete}><Trash2 size={14}/></button></div>;
  return <article className={`report-block-editor ${active ? "active" : ""}`} onFocus={onFocus}>
    {controls}
    {block.type === "cover" && <div className="report-block-fields"><label><span>Título de portada</span><input disabled={readonly} value={block.title} onChange={(event) => onChange({ ...block, title: event.target.value })}/></label><label><span>Subtítulo</span><input disabled={readonly} value={block.subtitle} onChange={(event) => onChange({ ...block, subtitle: event.target.value })}/></label></div>}
    {block.type === "heading" && <div className="report-block-fields compact"><label><span>Encabezado</span><input disabled={readonly} value={block.content} onChange={(event) => onChange({ ...block, content: event.target.value })}/></label><label><span>Nivel</span><select disabled={readonly} value={block.level} onChange={(event) => onChange({ ...block, level: Number(event.target.value) === 2 ? 2 : 1 })}><option value={1}>Principal</option><option value={2}>Secundario</option></select></label></div>}
    {block.type === "paragraph" && <label className="report-paragraph-editor"><span>Párrafo editable</span><textarea disabled={readonly} value={block.content} onChange={(event) => onChange({ ...block, content: event.target.value })}/></label>}
    {block.type === "profile_fields" && <div className="report-block-fields"><label><span>Título de la sección</span><input disabled={readonly} value={block.title} onChange={(event) => onChange({ ...block, title: event.target.value })}/></label><div className="report-field-selector">{REPORT_VARIABLES.filter((item) => item.key !== "autor" && item.key !== "fecha_actual").map((field) => <label key={field.key}><input type="checkbox" disabled={readonly} checked={block.fields.includes(field.key)} onChange={(event) => onChange({ ...block, fields: event.target.checked ? [...block.fields, field.key] : block.fields.filter((item) => item !== field.key) })}/><span>{field.label}</span></label>)}</div></div>}
    {block.type === "graph" && <div className="report-source-block"><label><span>Título de la gráfica</span><input disabled={readonly} value={block.title} onChange={(event) => onChange({ ...block, title: event.target.value })}/></label><div><GraphCanvas graph={block.graph} density="compact" edgeInset/></div><small>Instantánea de la gráfica seleccionada · {block.graph.points.length} puntos</small></div>}
    {block.type === "table" && <div className="report-source-block"><label><span>Título de la tabla</span><input disabled={readonly} value={block.title} onChange={(event) => onChange({ ...block, title: event.target.value })}/></label><div className="report-builder-table"><table><thead><tr>{block.data.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{block.data.rows.slice(0, 4).map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell ?? ""}</td>)}</tr>)}</tbody></table></div><small>{block.data.rows.length} fila{block.data.rows.length === 1 ? "" : "s"} · instantánea de {block.sourceType}</small></div>}
    {block.type === "metrics" && <div className="report-block-fields"><label><span>Título</span><input disabled={readonly} value={block.title} onChange={(event) => onChange({ ...block, title: event.target.value })}/></label><div className="report-metric-editor">{block.items.map((item, itemIndex) => <div key={itemIndex}><input disabled={readonly} aria-label={`Indicador ${itemIndex + 1}`} value={item.label} onChange={(event) => onChange({ ...block, items: block.items.map((current, currentIndex) => currentIndex === itemIndex ? { ...current, label: event.target.value } : current) })}/><input disabled={readonly} aria-label={`Valor ${itemIndex + 1}`} value={item.value} onChange={(event) => onChange({ ...block, items: block.items.map((current, currentIndex) => currentIndex === itemIndex ? { ...current, value: event.target.value } : current) })}/><button disabled={readonly} aria-label="Eliminar indicador" onClick={() => onChange({ ...block, items: block.items.filter((_, currentIndex) => currentIndex !== itemIndex) })}><X size={14}/></button></div>)}<button disabled={readonly} onClick={() => onChange({ ...block, items: [...block.items, { label: "Indicador", value: "Valor" }] })}><Plus size={14}/> Agregar indicador</button></div></div>}
    {block.type === "divider" && <div className="report-divider-editor"><Minus size={20}/><span>Separador visual</span></div>}
    {block.type === "signature" && <div className="report-block-fields signature-fields"><label><span>Nombre</span><input disabled={readonly} value={block.name} onChange={(event) => onChange({ ...block, name: event.target.value })}/></label><label><span>Cargo o credencial</span><input disabled={readonly} value={block.role} onChange={(event) => onChange({ ...block, role: event.target.value })}/></label><label><span>Etiqueta</span><input disabled={readonly} value={block.label} onChange={(event) => onChange({ ...block, label: event.target.value })}/></label></div>}
  </article>;
}

export default function ReportManager({
  profiles,
  selectedProfileId,
  onSelectProfile,
  canManage,
  brandName,
  logoUrl,
  accountName,
  notify,
}: {
  profiles: PersonnelProfile[];
  selectedProfileId: string;
  onSelectProfile: (profileId: string) => void;
  canManage: boolean;
  brandName: string;
  logoUrl: string | null;
  accountName: string;
  notify: (message: string) => void;
}) {
  const [reports, setReports] = useState<ReportRecord[]>([]);
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [sources, setSources] = useState<ReportSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mode, setMode] = useState<"library" | "builder" | "preview">("library");
  const [draft, setDraft] = useState<BuilderReport | null>(null);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [profileFilter, setProfileFilter] = useState(selectedProfileId === "all" ? "all" : selectedProfileId);
  const [templatePanel, setTemplatePanel] = useState(false);
  const [templateForm, setTemplateForm] = useState({ name: "", description: "" });

  async function loadLibrary() {
    const response = await fetch("/api/reports", { cache: "no-store" });
    const data = await response.json() as { reports?: ReportRecord[]; templates?: ReportTemplate[]; error?: string };
    if (!response.ok) throw new Error(data.error || "No se pudieron cargar los informes.");
    setReports(data.reports || []);
    setTemplates(data.templates || []);
  }

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/reports", { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ response, data: await response.json() as { reports?: ReportRecord[]; templates?: ReportTemplate[]; error?: string } }))
      .then(({ response, data }) => {
        if (!response.ok) throw new Error(data.error || "No se pudieron cargar los informes.");
        setReports(data.reports || []);
        setTemplates(data.templates || []);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) notify(error instanceof Error ? error.message : "No se pudieron cargar los informes.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  // This module owns its initial library request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadSources(profileId: string, updateSnapshot = true) {
    if (!profileId) return;
    setSourcesLoading(true);
    try {
      const response = await fetch(`/api/reports?profileId=${encodeURIComponent(profileId)}`, { cache: "no-store" });
      const data = await response.json() as { profile?: ReportProfileSnapshot; sources?: ReportSource[]; error?: string };
      if (!response.ok || !data.profile) throw new Error(data.error || "No se pudieron cargar los datos del niño.");
      setSources(data.sources || []);
      if (updateSnapshot) setDraft((current) => current ? { ...current, profileId, profileSnapshot: data.profile || current.profileSnapshot } : current);
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudieron cargar los datos del niño."); }
    finally { setSourcesLoading(false); }
  }

  function startReport(template?: ReportTemplate) {
    const profileId = selectedProfileId !== "all" ? selectedProfileId : profiles.find((profile) => profile.status === "active")?.id || "";
    const blocks = template ? cloneBlocks(template.blocks) : blankBlocks();
    setDraft({
      id: null,
      profileId,
      templateId: template?.id || null,
      title: template?.name || "Nuevo informe",
      reportType: template?.reportType || "Clínico",
      status: "draft",
      blocks,
      profileSnapshot: null,
      sourceSelection: [],
      authorName: accountName,
    });
    setSelectedSources([]);
    setFocusedBlockId(blocks[0]?.id || null);
    setMode("builder");
    if (profileId) {
      onSelectProfile(profileId);
      loadSources(profileId).catch(() => undefined);
    }
  }

  function openReport(report: ReportRecord) {
    setDraft({
      id: report.id,
      profileId: report.profileId || "",
      templateId: report.templateId,
      title: report.title,
      reportType: report.reportType,
      status: report.status,
      blocks: structuredClone(report.blocks),
      profileSnapshot: report.profileSnapshot,
      sourceSelection: report.sourceSelection,
      authorName: report.authorName,
    });
    setSelectedSources([]);
    setFocusedBlockId(report.blocks[0]?.id || null);
    if (report.profileId) {
      onSelectProfile(report.profileId);
      loadSources(report.profileId, report.status !== "finalized").catch(() => undefined);
    }
    setMode(report.status === "finalized" ? "preview" : "builder");
  }

  function updateBlock(next: ReportBlock) {
    setDraft((current) => current ? { ...current, blocks: current.blocks.map((block) => block.id === next.id ? next : block) } : current);
  }

  function moveBlock(index: number, direction: -1 | 1) {
    setDraft((current) => {
      if (!current) return current;
      const next = [...current.blocks];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, blocks: next };
    });
  }

  function addBlock(type: "heading" | "paragraph" | "profile_fields" | "metrics" | "divider" | "signature") {
    const block: ReportBlock = type === "heading" ? { id: localId(type), type, content: "Nuevo encabezado", level: 1 }
      : type === "paragraph" ? { id: localId(type), type, content: "Nuevo párrafo editable." }
      : type === "profile_fields" ? { id: localId(type), type, title: "Información del perfil", fields: ["nombre_cliente", "diagnostico", "sede"] }
      : type === "metrics" ? { id: localId(type), type, title: "Indicadores", items: [{ label: "Indicador", value: "Valor" }] }
      : type === "divider" ? { id: localId(type), type }
      : { id: localId(type), type, label: "Firma", name: "{autor}", role: "" };
    setDraft((current) => current ? { ...current, blocks: [...current.blocks, block] } : current);
    setFocusedBlockId(block.id);
  }

  function insertVariable(key: string) {
    setDraft((current) => {
      if (!current) return current;
      const index = current.blocks.findIndex((block) => block.id === focusedBlockId && (block.type === "paragraph" || block.type === "heading" || block.type === "cover"));
      if (index < 0) {
        const block: ReportBlock = { id: localId("paragraph"), type: "paragraph", content: `{${key}}` };
        setFocusedBlockId(block.id);
        return { ...current, blocks: [...current.blocks, block] };
      }
      const blocks = [...current.blocks];
      const block = blocks[index];
      if (block.type === "paragraph" || block.type === "heading") blocks[index] = { ...block, content: `${block.content}${block.content ? " " : ""}{${key}}` };
      else if (block.type === "cover") blocks[index] = { ...block, subtitle: `${block.subtitle}${block.subtitle ? " · " : ""}{${key}}` };
      return { ...current, blocks };
    });
  }

  function insertSources() {
    if (!draft || !selectedSources.length) return notify("Selecciona al menos un dato, tabla o gráfica.");
    const chosen = sources.filter((source) => selectedSources.includes(source.id));
    const blocks = chosen.flatMap<ReportBlock>((source) => {
      if (source.kind === "graph" && source.graph) return [{ id: localId("graph"), type: "graph", sourceId: source.id, title: source.title, graph: structuredClone(source.graph) }];
      if (source.table) return [{ id: localId("table"), type: "table", sourceId: source.id, title: source.title, sourceType: source.kind, data: structuredClone(source.table) }];
      return [];
    });
    setDraft({ ...draft, blocks: [...draft.blocks, ...blocks], sourceSelection: [...new Set([...draft.sourceSelection, ...chosen.map((source) => source.id)])] });
    setSelectedSources([]);
    notify(`${blocks.length} elemento${blocks.length === 1 ? "" : "s"} añadido${blocks.length === 1 ? "" : "s"} al informe.`);
  }

  async function saveReport(finalize = false) {
    if (!draft?.profileId || !draft.profileSnapshot) return notify("Selecciona un niño antes de guardar.");
    if (!draft.title.trim()) return notify("Escribe el título del informe.");
    setSaving(true);
    try {
      const response = await fetch("/api/reports", {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(draft.id ? { id: draft.id, action: finalize ? "finalize" : "save" } : { action: "create_report", status: finalize ? "finalized" : "draft" }),
          profileId: draft.profileId,
          templateId: draft.templateId,
          title: draft.title,
          reportType: draft.reportType,
          blocks: draft.blocks,
          sourceSelection: draft.sourceSelection,
        }),
      });
      const data = await response.json() as { report?: ReportRecord; error?: string };
      if (!response.ok || !data.report) throw new Error(data.error || "No se pudo guardar el informe.");
      const saved = data.report;
      setDraft({ id: saved.id, profileId: saved.profileId || "", templateId: saved.templateId, title: saved.title, reportType: saved.reportType, status: saved.status, blocks: saved.blocks, profileSnapshot: saved.profileSnapshot, sourceSelection: saved.sourceSelection, authorName: saved.authorName });
      await loadLibrary();
      setMode(finalize ? "preview" : "builder");
      notify(finalize ? "Informe finalizado y añadido al historial." : "Borrador guardado.");
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo guardar el informe."); }
    finally { setSaving(false); }
  }

  async function saveTemplate() {
    if (!draft || !templateForm.name.trim()) return notify("Escribe un nombre para la plantilla.");
    setSaving(true);
    try {
      const response = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save_template", name: templateForm.name, reportType: draft.reportType, description: templateForm.description, blocks: draft.blocks.filter((block) => block.type !== "graph" && block.type !== "table") }) });
      const data = await response.json() as { template?: ReportTemplate; error?: string };
      if (!response.ok || !data.template) throw new Error(data.error || "No se pudo guardar la plantilla.");
      setTemplates((current) => [...current, data.template as ReportTemplate].sort((a, b) => a.name.localeCompare(b.name, "es")));
      setTemplatePanel(false);
      setTemplateForm({ name: "", description: "" });
      notify("Plantilla guardada y disponible para cualquier niño.");
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo guardar la plantilla."); }
    finally { setSaving(false); }
  }

  async function duplicateReport(report: ReportRecord) {
    setSaving(true);
    try {
      const response = await fetch("/api/reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "duplicate_report", id: report.id }) });
      const data = await response.json() as { report?: ReportRecord; error?: string };
      if (!response.ok || !data.report) throw new Error(data.error || "No se pudo duplicar el informe.");
      await loadLibrary();
      openReport(data.report);
      notify("Se creó una copia editable en borrador.");
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo duplicar el informe."); }
    finally { setSaving(false); }
  }

  async function deleteDraft(report: ReportRecord) {
    if (!window.confirm(`¿Eliminar el borrador “${report.title}”?`)) return;
    const response = await fetch("/api/reports", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: report.id }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) return notify(data.error || "No se pudo eliminar el borrador.");
    setReports((current) => current.filter((item) => item.id !== report.id));
    notify("Borrador eliminado.");
  }

  const visibleReports = useMemo(() => reports.filter((report) => {
    const needle = query.trim().toLocaleLowerCase("es");
    return (statusFilter === "all" || report.status === statusFilter)
      && (profileFilter === "all" || report.profileId === profileFilter)
      && (!needle || [report.title, report.reportType, report.profileName, report.authorName].some((value) => value.toLocaleLowerCase("es").includes(needle)));
  }), [profileFilter, query, reports, statusFilter]);

  const groupedSources = useMemo(() => ({
    graph: sources.filter((source) => source.kind === "graph"),
    evaluation: sources.filter((source) => source.kind === "evaluation"),
    program: sources.filter((source) => source.kind === "program"),
    sessions: sources.filter((source) => source.kind === "sessions"),
  }), [sources]);

  if (loading) return <section className="formation-panel intervention-empty"><LoaderCircle className="spin" size={28}/><strong>Cargando Informes…</strong></section>;

  if (mode === "preview" && draft) return <div className="report-preview-page">
    <div className="report-preview-toolbar"><button className="back-button" onClick={() => setMode(draft.status === "finalized" ? "library" : "builder")}><ArrowLeft size={16}/> Volver</button><div><p className="section-kicker">Vista previa</p><h1>{draft.title}</h1><span className={`report-status ${draft.status}`}>{draft.status === "finalized" ? <CheckCircle2 size={14}/> : <FileText size={14}/>} {draft.status === "finalized" ? "Finalizado" : "Borrador"}</span></div><div>{draft.status === "draft" && canManage && <button className="secondary-formation-button" onClick={() => setMode("builder")}>Continuar editando</button>}<button className="primary-formation-button" onClick={() => window.print()}><Printer size={16}/> Imprimir / guardar PDF</button></div></div>
    <ReportDocument report={draft} brandName={brandName} logoUrl={logoUrl}/>
  </div>;

  if (mode === "builder" && draft) {
    const readonly = !canManage || draft.status === "finalized";
    return <div className="report-builder-page">
      <div className="report-builder-topbar"><button className="back-button" onClick={() => setMode("library")}><ArrowLeft size={16}/> Informes</button><div><p className="section-kicker">Constructor modular</p><h1>{draft.id ? draft.title : "Nuevo informe"}</h1><small>{draft.blocks.length} bloques · {draft.sourceSelection.length} fuentes insertadas</small></div><div><button className="secondary-formation-button" onClick={() => setMode("preview")}><Eye size={16}/> Vista previa</button>{canManage && <button className="secondary-formation-button" onClick={() => { setTemplatePanel(true); setTemplateForm({ name: `${draft.title} · plantilla`, description: "Plantilla personalizada creada desde un informe." }); }}><LayoutTemplate size={16}/> Guardar como plantilla</button>}<button className="primary-formation-button" disabled={readonly || saving} onClick={() => saveReport(false)}>{saving ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>} Guardar borrador</button><button className="report-finalize-button" disabled={readonly || saving} onClick={() => { if (window.confirm("Al finalizar, este informe quedará de solo lectura. ¿Continuar?")) saveReport(true); }}><Check size={16}/> Finalizar</button></div></div>

      <div className="report-builder-layout">
        <aside className="report-builder-sidebar">
          <section><p className="section-kicker">Documento</p><label><span>Niño</span><select disabled={readonly} value={draft.profileId} onChange={(event) => { const profileId = event.target.value; onSelectProfile(profileId); setDraft({ ...draft, profileId, profileSnapshot: null, sourceSelection: [], blocks: draft.blocks.filter((block) => block.type !== "graph" && block.type !== "table") }); setSources([]); loadSources(profileId).catch(() => undefined); }}>{profiles.filter((profile) => profile.status === "active" || profile.id === draft.profileId).map((profile) => <option value={profile.id} key={profile.id}>{profile.fullName} · {profile.site}</option>)}</select></label><label><span>Título</span><input disabled={readonly} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/></label><label><span>Tipo</span><input disabled={readonly} value={draft.reportType} onChange={(event) => setDraft({ ...draft, reportType: event.target.value })} placeholder="Ej. Progreso"/></label></section>
          <section><p className="section-kicker">Agregar bloque</p><div className="report-block-palette"><button disabled={readonly} onClick={() => addBlock("heading")}><Heading1 size={16}/> Encabezado</button><button disabled={readonly} onClick={() => addBlock("paragraph")}><Type size={16}/> Texto</button><button disabled={readonly} onClick={() => addBlock("profile_fields")}><UserRound size={16}/> Datos del perfil</button><button disabled={readonly} onClick={() => addBlock("metrics")}><Layers3 size={16}/> Indicadores</button><button disabled={readonly} onClick={() => addBlock("divider")}><Minus size={16}/> Separador</button><button disabled={readonly} onClick={() => addBlock("signature")}><Signature size={16}/> Firma</button></div></section>
          <section><p className="section-kicker">Campos dinámicos</p><p>Se reemplazan automáticamente con el perfil seleccionado.</p><div className="report-variable-palette">{REPORT_VARIABLES.map((variable) => <button disabled={readonly} key={variable.key} onClick={() => insertVariable(variable.key)} title={`Insertar {${variable.key}}`}><Plus size={12}/>{variable.label}</button>)}</div></section>
        </aside>

        <main className="report-block-canvas" aria-label="Bloques del informe">
          <header><div><p className="section-kicker">Contenido editable</p><h2>Estructura del informe</h2></div><span>{draft.blocks.length} bloques</span></header>
          {draft.blocks.map((block, index) => <BlockEditor key={block.id} block={block} index={index} total={draft.blocks.length} readonly={readonly} active={focusedBlockId === block.id} onFocus={() => setFocusedBlockId(block.id)} onChange={updateBlock} onMove={(direction) => moveBlock(index, direction)} onDelete={() => setDraft({ ...draft, blocks: draft.blocks.filter((item) => item.id !== block.id), sourceSelection: block.type === "graph" || block.type === "table" ? draft.sourceSelection.filter((item) => item !== block.sourceId) : draft.sourceSelection })}/>) }
          {!draft.blocks.length && <div className="report-empty-canvas"><FilePlus2 size={30}/><strong>El informe no tiene bloques</strong><p>Agrega texto, datos del perfil, tablas, gráficas o firmas desde los paneles laterales.</p></div>}
        </main>

        <aside className="report-data-sidebar">
          <header><div><p className="section-kicker">Datos disponibles</p><h2>Seleccionar información</h2></div>{sourcesLoading && <LoaderCircle className="spin" size={18}/>}</header>
          <p>Solo se insertará la información que marques.</p>
          {(["graph", "evaluation", "program", "sessions"] as const).map((kind) => {
            const labels = { graph: "Gráficas", evaluation: "Evaluaciones", program: "Programas", sessions: "Últimas sesiones" };
            const items = groupedSources[kind];
            if (!items.length) return null;
            return <section className="report-source-group" key={kind}><h3>{labels[kind]} <span>{items.length}</span></h3>{items.map((source) => <label key={source.id}><input type="checkbox" disabled={readonly || draft.sourceSelection.includes(source.id)} checked={selectedSources.includes(source.id) || draft.sourceSelection.includes(source.id)} onChange={(event) => setSelectedSources(event.target.checked ? [...selectedSources, source.id] : selectedSources.filter((item) => item !== source.id))}/><span>{source.kind === "graph" ? <BarChart3 size={15}/> : source.kind === "evaluation" ? <ClipboardList size={15}/> : source.kind === "program" ? <FolderOpen size={15}/> : <Table2 size={15}/>}</span><div><strong>{source.title}</strong><small>{draft.sourceSelection.includes(source.id) ? "Ya insertado" : source.detail}</small></div></label>)}</section>;
          })}
          {!sourcesLoading && !sources.length && <div className="report-no-sources"><FolderOpen size={25}/><strong>Sin fuentes disponibles</strong><p>Este perfil aún no tiene datos accesibles para tu rol.</p></div>}
          <button className="primary-formation-button report-insert-data" disabled={readonly || !selectedSources.length} onClick={insertSources}><Plus size={16}/> Insertar seleccionados</button>
        </aside>
      </div>

      {templatePanel && <div className="modal-backdrop"><section className="report-template-modal" role="dialog" aria-modal="true" aria-labelledby="template-save-title"><div className="modal-title"><div><p className="section-kicker">Estructura reutilizable</p><h2 id="template-save-title">Guardar como plantilla</h2></div><button aria-label="Cerrar" onClick={() => setTemplatePanel(false)}><X size={18}/></button></div><p>La estructura, los textos y campos dinámicos quedarán disponibles para cualquier niño. Por privacidad, las gráficas y tablas clínicas seleccionadas no se guardan en la plantilla.</p><label><span>Nombre de la plantilla</span><input autoFocus value={templateForm.name} onChange={(event) => setTemplateForm({ ...templateForm, name: event.target.value })}/></label><label><span>Descripción</span><textarea value={templateForm.description} onChange={(event) => setTemplateForm({ ...templateForm, description: event.target.value })}/></label><div className="modal-actions"><button className="secondary-formation-button" onClick={() => setTemplatePanel(false)}>Cancelar</button><button className="primary-formation-button" disabled={saving || !templateForm.name.trim()} onClick={saveTemplate}>{saving ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>} Guardar plantilla</button></div></section></div>}
    </div>;
  }

  return <div className="report-library">
    <div className="formation-heading report-heading"><div><p className="section-kicker">Documentación conectada</p><h1>Informes</h1><p>Crea documentos a partir de los datos existentes, selecciona únicamente la evidencia relevante y conserva control manual sobre el resultado.</p></div>{canManage && <button className="primary-formation-button" onClick={() => startReport()}><FilePlus2 size={17}/> Crear informe</button>}</div>
    <section className="report-flow"><span>1</span><strong>Perfil</strong><ChevronRight size={15}/><span>2</span><strong>Plantilla</strong><ChevronRight size={15}/><span>3</span><strong>Datos</strong><ChevronRight size={15}/><span>4</span><strong>Edición</strong><ChevronRight size={15}/><span>5</span><strong>Vista previa</strong></section>

    <section className="report-template-library"><header><div><p className="section-kicker">Puntos de partida</p><h2>Plantillas reutilizables</h2></div><span>{templates.length} plantilla{templates.length === 1 ? "" : "s"}</span></header><div>{templates.map((template) => <article key={template.id}><span><LayoutTemplate size={20}/></span><div><small>{template.reportType}{template.builtIn ? " · Institucional" : " · Personalizada"}</small><h3>{template.name}</h3><p>{template.description || "Estructura reutilizable para cualquier perfil."}</p></div><footer><span>{template.blocks.length} bloques</span>{canManage && <button onClick={() => startReport(template)}>Usar plantilla <ChevronRight size={15}/></button>}</footer></article>)}</div></section>

    <section className="report-history-panel"><header><div><p className="section-kicker">Historial documental</p><h2>Informes por perfil</h2></div><span>{visibleReports.length} resultado{visibleReports.length === 1 ? "" : "s"}</span></header><div className="report-history-toolbar"><label><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar informe, niño, tipo o autor"/></label><select value={profileFilter} onChange={(event) => setProfileFilter(event.target.value)}><option value="all">Todos los niños</option>{profiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.fullName}</option>)}</select><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Todos los estados</option><option value="draft">Borradores</option><option value="finalized">Finalizados</option></select></div>
      {visibleReports.length ? <div className="report-history-table"><div className="report-history-head"><span>Fecha</span><span>Informe</span><span>Perfil</span><span>Tipo</span><span>Autor</span><span>Estado</span><span>Acciones</span></div>{visibleReports.map((report) => <article key={report.id}><span>{dateLabel(report.finalizedAt || report.updatedAt)}</span><div><strong>{report.title}</strong><small>{report.blocks.length} bloques · {report.sourceSelection.length} fuentes</small></div><span>{report.profileName}</span><span>{report.reportType}</span><span>{report.authorName}</span><span className={`report-status ${report.status}`}>{report.status === "finalized" ? <CheckCircle2 size={13}/> : <FileText size={13}/>} {statusLabel(report.status)}</span><div><button onClick={() => openReport(report)} title={report.status === "finalized" ? "Visualizar" : "Editar"}>{report.status === "finalized" ? <Eye size={15}/> : <FileText size={15}/>}</button>{canManage && <button onClick={() => duplicateReport(report)} title="Duplicar"><Copy size={15}/></button>}{canManage && report.status === "draft" && <button className="danger-action" onClick={() => deleteDraft(report)} title="Eliminar borrador"><Trash2 size={15}/></button>}</div></article>)}</div> : <div className="report-empty-history"><FileText size={30}/><strong>No hay informes en esta selección</strong><p>{canManage ? "Crea un informe desde cero o utiliza una plantilla para comenzar." : "No hay documentos disponibles dentro de tu alcance."}</p>{canManage && <button className="primary-formation-button" onClick={() => startReport()}><Plus size={16}/> Crear primer informe</button>}</div>}
    </section>
  </div>;
}
