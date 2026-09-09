"use client";

import {
  Activity,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Clock3,
  FileText,
  ListFilter,
  LoaderCircle,
  MapPin,
  Plus,
  Save,
  Settings2,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";

type Category = { id: string; categoryType: "antecedent" | "consequence"; label: string; status: "active" | "inactive"; sortOrder: number };
type Program = { id: string; name: string; status: string };
type Target = { id: string; programId: string; code: string; name: string; state: string };
type ABCRecord = {
  id: string;
  profileId: string;
  sessionId: string | null;
  programId: string | null;
  targetId: string | null;
  recordedByName: string;
  eventDate: string;
  eventTime: string;
  locationContext: string;
  activity: string;
  antecedentLabel: string;
  antecedentDescription: string;
  behaviorLabel: string;
  behaviorDescription: string;
  consequenceLabel: string;
  consequenceDescription: string;
  additionalObservation: string;
  programName: string;
  targetName: string;
  sessionDate: string | null;
  rawDetailAvailable: boolean;
};

type CatalogPayload = {
  profile: { id: string; fullName: string; site: string };
  categories: Category[];
  programs: Program[];
  targets: Target[];
  records: ABCRecord[];
  canRecord: boolean;
  canManage: boolean;
};

type QuickContext = {
  profileId: string;
  profileName: string;
  programId?: string | null;
  sessionId?: string | null;
  appointmentId?: string | null;
};

function localDateTime() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    eventDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    eventTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
  };
}

function emptyDraft(context: QuickContext) {
  return {
    ...localDateTime(),
    profileId: context.profileId,
    programId: context.programId || "",
    sessionId: context.sessionId || "",
    appointmentId: context.appointmentId || "",
    targetId: "",
    locationContext: "",
    activity: "",
    antecedentCategoryId: "",
    antecedentLabel: "",
    antecedentDescription: "",
    behaviorLabel: "",
    behaviorDescription: "",
    consequenceCategoryId: "",
    consequenceLabel: "",
    consequenceDescription: "",
    additionalObservation: "",
  };
}

function formatDate(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("es-NI", { day: "2-digit", month: "short", year: "numeric" });
}

function countBy(records: ABCRecord[], field: keyof Pick<ABCRecord, "antecedentLabel" | "behaviorLabel" | "consequenceLabel" | "activity" | "locationContext" | "recordedByName">) {
  return [...records.reduce((map, record) => {
    const label = String(record[field] || "Sin especificar");
    map.set(label, (map.get(label) || 0) + 1);
    return map;
  }, new Map<string, number>())].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "es"));
}

function Distribution({ title, rows, Icon }: { title: string; rows: Array<{ label: string; count: number }>; Icon: ComponentType<{ size?: number }> }) {
  const maximum = Math.max(1, ...rows.map((row) => row.count));
  return <section className="formation-panel abc-distribution"><header><Icon size={18}/><h3>{title}</h3></header>{rows.length ? <div>{rows.slice(0, 8).map((row) => <article key={row.label}><span>{row.label}</span><div><i style={{ width: `${Math.max(6, row.count / maximum * 100)}%` }}/></div><strong>{row.count}</strong></article>)}</div> : <div className="abc-empty-small">Sin datos</div>}</section>;
}

export function ABCQuickCapture({ context, onClose, onSaved, notify }: { context: QuickContext; onClose: () => void; onSaved?: () => void; notify: (message: string) => void }) {
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [draft, setDraft] = useState(() => emptyDraft(context));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/abc-records?profileId=${encodeURIComponent(context.profileId)}&catalog=1`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ response, data: await response.json() as CatalogPayload & { error?: string } }))
      .then(({ response, data }) => {
        if (!response.ok) throw new Error(data.error || "No se pudo preparar el registro ABC.");
        setCatalog(data);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) notify(error instanceof Error ? error.message : "No se pudo preparar el registro ABC.");
      });
    return () => controller.abort();
  }, [context.profileId, notify]);

  const activeCategories = (type: Category["categoryType"]) => (catalog?.categories || []).filter((category) => category.categoryType === type && category.status === "active");
  const programTargets = (catalog?.targets || []).filter((target) => !draft.programId || target.programId === draft.programId);

  async function save() {
    if (!draft.antecedentCategoryId && !draft.antecedentLabel.trim()) return notify("Selecciona o describe el antecedente.");
    if (!draft.targetId && !draft.behaviorLabel.trim() && !draft.behaviorDescription.trim()) return notify("Selecciona o describe la conducta observada.");
    if (!draft.consequenceCategoryId && !draft.consequenceLabel.trim()) return notify("Selecciona o describe la consecuencia.");
    setSaving(true);
    try {
      const response = await fetch("/api/abc-records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const data = await response.json() as { record?: ABCRecord; error?: string };
      if (!response.ok || !data.record) throw new Error(data.error || "No se pudo guardar el Registro ABC.");
      notify("Registro ABC guardado en el expediente del niño.");
      onSaved?.();
      onClose();
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo guardar el Registro ABC.");
    } finally { setSaving(false); }
  }

  return <div className="modal-backdrop abc-modal-backdrop"><section className="abc-capture-modal" role="dialog" aria-modal="true" aria-labelledby="abc-capture-title">
    <div className="modal-title"><div><p className="section-kicker">Observación descriptiva</p><h2 id="abc-capture-title">Registrar ABC</h2><p>{context.profileName}</p></div><button aria-label="Cerrar" onClick={onClose}><X size={19}/></button></div>
    {!catalog ? <div className="abc-loading"><LoaderCircle className="spin" size={25}/><strong>Preparando registro…</strong></div> : <>
      <div className="abc-context-grid">
        <label><span>Fecha</span><input type="date" value={draft.eventDate} onChange={(event) => setDraft({ ...draft, eventDate: event.target.value })}/></label>
        <label><span>Hora</span><input type="time" value={draft.eventTime} onChange={(event) => setDraft({ ...draft, eventTime: event.target.value })}/></label>
        <label><span>Programa (opcional)</span><select disabled={Boolean(context.programId)} value={draft.programId} onChange={(event) => setDraft({ ...draft, programId: event.target.value, targetId: "" })}><option value="">Sin programa vinculado</option>{catalog.programs.map((program) => <option value={program.id} key={program.id}>{program.name}</option>)}</select></label>
        <label><span>Conducta objetivo (opcional)</span><select value={draft.targetId} onChange={(event) => setDraft({ ...draft, targetId: event.target.value })}><option value="">Observación descriptiva</option>{programTargets.map((target) => <option value={target.id} key={target.id}>{target.code} · {target.name}</option>)}</select></label>
        <label><span>Ubicación o contexto</span><input value={draft.locationContext} onChange={(event) => setDraft({ ...draft, locationContext: event.target.value })} placeholder="Ej. aula, comedor, patio"/></label>
        <label><span>Actividad en curso</span><input value={draft.activity} onChange={(event) => setDraft({ ...draft, activity: event.target.value })} placeholder="Ej. tarea de mesa, transición"/></label>
      </div>
      <div className="abc-chain-grid">
        <fieldset className="antecedent"><legend><span>A</span>Antecedente</legend><label><span>Categoría</span><select value={draft.antecedentCategoryId} onChange={(event) => setDraft({ ...draft, antecedentCategoryId: event.target.value })}><option value="">Otro / describir</option>{activeCategories("antecedent").map((category) => <option value={category.id} key={category.id}>{category.label}</option>)}</select></label>{!draft.antecedentCategoryId && <label><span>Nombre breve</span><input value={draft.antecedentLabel} onChange={(event) => setDraft({ ...draft, antecedentLabel: event.target.value })} placeholder="Qué ocurrió inmediatamente antes"/></label>}<label><span>Descripción observable</span><textarea value={draft.antecedentDescription} onChange={(event) => setDraft({ ...draft, antecedentDescription: event.target.value })}/></label></fieldset>
        <fieldset className="behavior"><legend><span>B</span>Conducta</legend>{!draft.targetId && <label><span>Nombre breve</span><input value={draft.behaviorLabel} onChange={(event) => setDraft({ ...draft, behaviorLabel: event.target.value })} placeholder="Conducta observada"/></label>}<label><span>Descripción observable</span><textarea value={draft.behaviorDescription} onChange={(event) => setDraft({ ...draft, behaviorDescription: event.target.value })} placeholder="Describa exactamente lo que la persona hizo"/></label></fieldset>
        <fieldset className="consequence"><legend><span>C</span>Consecuencia</legend><label><span>Categoría</span><select value={draft.consequenceCategoryId} onChange={(event) => setDraft({ ...draft, consequenceCategoryId: event.target.value })}><option value="">Otro / describir</option>{activeCategories("consequence").map((category) => <option value={category.id} key={category.id}>{category.label}</option>)}</select></label>{!draft.consequenceCategoryId && <label><span>Nombre breve</span><input value={draft.consequenceLabel} onChange={(event) => setDraft({ ...draft, consequenceLabel: event.target.value })} placeholder="Qué ocurrió inmediatamente después"/></label>}<label><span>Descripción observable</span><textarea value={draft.consequenceDescription} onChange={(event) => setDraft({ ...draft, consequenceDescription: event.target.value })}/></label></fieldset>
      </div>
      <label className="abc-additional"><span>Observación adicional (opcional)</span><textarea value={draft.additionalObservation} onChange={(event) => setDraft({ ...draft, additionalObservation: event.target.value })} placeholder="Información contextual breve que ayude a interpretar el episodio"/></label>
      <div className="abc-descriptive-note"><AlertTriangle size={17}/><p>Este registro describe relaciones observadas. No determina por sí solo la función de la conducta.</p></div>
      <div className="modal-actions"><button className="secondary-formation-button" onClick={onClose}>Cancelar</button><button className="primary-formation-button" disabled={saving} onClick={save}>{saving ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>} Guardar ABC</button></div>
    </>}
  </section></div>;
}

export default function ABCManager({ profileId, profileName, notify }: { profileId: string; profileName: string; notify: (message: string) => void }) {
  const [data, setData] = useState<CatalogPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [categoryDraft, setCategoryDraft] = useState({ categoryType: "antecedent" as Category["categoryType"], label: "" });
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/abc-records?profileId=${encodeURIComponent(profileId)}`, { cache: "no-store" });
      const payload = await response.json() as CatalogPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudo cargar el Registro ABC.");
      setData(payload);
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo cargar el Registro ABC.");
    } finally { setLoading(false); }
  }, [notify, profileId]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/abc-records?profileId=${encodeURIComponent(profileId)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ response, payload: await response.json() as CatalogPayload & { error?: string } }))
      .then(({ response, payload }) => {
        if (!response.ok) throw new Error(payload.error || "No se pudo cargar el Registro ABC.");
        setData(payload);
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) notify(error instanceof Error ? error.message : "No se pudo cargar el Registro ABC.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [notify, profileId]);

  const records = useMemo(() => (data?.records || []).filter((record) => !filter || record.behaviorLabel === filter), [data, filter]);
  const antecedents = useMemo(() => countBy(records, "antecedentLabel"), [records]);
  const behaviors = useMemo(() => countBy(records, "behaviorLabel"), [records]);
  const consequences = useMemo(() => countBy(records, "consequenceLabel"), [records]);
  const activities = useMemo(() => countBy(records, "activity"), [records]);
  const contexts = useMemo(() => countBy(records, "locationContext"), [records]);
  const professionals = useMemo(() => countBy(records, "recordedByName"), [records]);
  const hours = useMemo(() => [...records.reduce((map, record) => {
    const hour = Number(record.eventTime.slice(0, 2));
    const label = Number.isFinite(hour) ? `${String(hour).padStart(2, "0")}:00–${String((hour + 1) % 24).padStart(2, "0")}:00` : "Sin horario";
    map.set(label, (map.get(label) || 0) + 1);
    return map;
  }, new Map<string, number>())].map(([label, count]) => ({ label, count })).sort((a, b) => a.label.localeCompare(b.label, "es")), [records]);
  const combinations = useMemo(() => [...records.reduce((map, record) => {
    const label = `${record.antecedentLabel} → ${record.behaviorLabel} → ${record.consequenceLabel}`;
    map.set(label, (map.get(label) || 0) + 1);
    return map;
  }, new Map<string, number>())].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count).slice(0, 8), [records]);

  async function createCategory() {
    if (!categoryDraft.label.trim()) return;
    const response = await fetch("/api/abc-records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create_category", ...categoryDraft }) });
    const payload = await response.json() as { category?: Category; error?: string };
    if (!response.ok || !payload.category) return notify(payload.error || "No se pudo crear la categoría.");
    setCategoryDraft({ ...categoryDraft, label: "" });
    await load();
    notify("Categoría ABC creada.");
  }

  async function setCategoryStatus(category: Category) {
    const response = await fetch("/api/abc-records", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "set_category_status", id: category.id, status: category.status === "active" ? "inactive" : "active" }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) return notify(payload.error || "No se pudo actualizar la categoría.");
    await load();
  }

  async function deleteRecord(record: ABCRecord) {
    if (!window.confirm("¿Eliminar este registro ABC? Esta acción no puede deshacerse.")) return;
    const response = await fetch("/api/abc-records", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: record.id }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) return notify(payload.error || "No se pudo eliminar el registro.");
    await load();
    notify("Registro ABC eliminado.");
  }

  if (loading) return <div className="abc-loading"><LoaderCircle className="spin" size={27}/><strong>Cargando Registro ABC…</strong></div>;
  if (!data) return null;

  return <div className="abc-workspace">
    <div className="formation-heading"><div><p className="section-kicker">Evaluación descriptiva</p><h1>Registro ABC de {profileName}</h1><p>Antecedentes, conductas y consecuencias observadas en su contexto clínico.</p></div><div className="abc-heading-actions">{data.canManage && <button className="secondary-formation-button" onClick={() => setCategoryOpen(true)}><Settings2 size={16}/> Categorías</button>}{data.canRecord && <button className="primary-formation-button" onClick={() => setCaptureOpen(true)}><Plus size={16}/> Registrar ABC</button>}</div></div>
    <section className="abc-clinical-boundary"><AlertTriangle size={21}/><div><strong>Análisis descriptivo, no demostración funcional</strong><p>Las distribuciones muestran patrones y correlaciones observadas. Pueden orientar hipótesis, pero no establecen automáticamente la función de una conducta.</p></div></section>
    <div className="abc-metrics"><article><span><Activity size={19}/></span><div><small>Episodios</small><strong>{records.length}</strong></div></article><article><span><Clock3 size={19}/></span><div><small>Último registro</small><strong>{records[0] ? formatDate(records[0].eventDate) : "—"}</strong></div></article><article><span><ListFilter size={19}/></span><div><small>Conductas</small><strong>{behaviors.length}</strong></div></article><article><span><MapPin size={19}/></span><div><small>Contextos</small><strong>{countBy(records, "locationContext").length}</strong></div></article></div>
    <div className="abc-filter-row"><label><ListFilter size={15}/><span>Conducta</span><select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">Todas las conductas</option>{countBy(data.records, "behaviorLabel").map((row) => <option value={row.label} key={row.label}>{row.label}</option>)}</select></label><span>{records.length} registro{records.length === 1 ? "" : "s"}</span></div>
    <div className="abc-analysis-grid"><Distribution title="Frecuencia por antecedente" rows={antecedents} Icon={BarChart3}/><Distribution title="Frecuencia por conducta" rows={behaviors} Icon={Activity}/><Distribution title="Frecuencia por consecuencia" rows={consequences} Icon={CheckCircle2}/><Distribution title="Conducta por actividad" rows={activities} Icon={FileText}/><Distribution title="Conducta por contexto" rows={contexts} Icon={MapPin}/><Distribution title="Conducta por horario" rows={hours} Icon={Clock3}/><Distribution title="Registros por profesional" rows={professionals} Icon={UserRound}/></div>
    <section className="formation-panel abc-combinations"><header><div><p className="section-kicker">Secuencias descriptivas</p><h2>Combinaciones A–B–C más frecuentes</h2></div><span>{combinations.length}</span></header>{combinations.length ? <div>{combinations.map((row, index) => <article key={row.label}><span>{index + 1}</span><p>{row.label}</p><strong>{row.count}</strong></article>)}</div> : <div className="abc-empty"><CircleDashed size={27}/><strong>Aún no hay combinaciones registradas</strong></div>}</section>
    <section className="formation-panel abc-history"><header><div><p className="section-kicker">Historial clínico</p><h2>Registros ABC</h2></div><span>{records.length}</span></header>{records.length ? <div>{records.map((record) => <article key={record.id}><div className="abc-record-meta"><time>{formatDate(record.eventDate)}{record.eventTime ? ` · ${record.eventTime}` : ""}</time><span><UserRound size={13}/>{record.recordedByName}</span>{record.locationContext && <span><MapPin size={13}/>{record.locationContext}</span>}</div>{record.rawDetailAvailable ? <div className="abc-record-chain"><section><small>Antecedente</small><strong>{record.antecedentLabel}</strong><p>{record.antecedentDescription || "Sin descripción adicional"}</p></section><ChevronDown size={17}/><section><small>Conducta</small><strong>{record.behaviorLabel}</strong><p>{record.behaviorDescription || "Sin descripción adicional"}</p></section><ChevronDown size={17}/><section><small>Consecuencia</small><strong>{record.consequenceLabel}</strong><p>{record.consequenceDescription || "Sin descripción adicional"}</p></section></div> : <div className="abc-descriptive-note"><AlertTriangle size={17}/><p>Este episodio se incluye en el progreso agregado. El detalle pertenece a una observación registrada por otro profesional.</p></div>}<footer><span>{record.programName}{record.rawDetailAvailable && record.activity ? ` · ${record.activity}` : record.targetName ? ` · ${record.targetName}` : ""}</span>{record.rawDetailAvailable && record.additionalObservation && <p>{record.additionalObservation}</p>}{data.canManage && record.rawDetailAvailable && <button className="danger-action" aria-label="Eliminar registro ABC" onClick={() => deleteRecord(record)}><Trash2 size={15}/></button>}</footer></article>)}</div> : <div className="abc-empty"><CircleDashed size={29}/><strong>Aún no hay registros ABC</strong><p>Los episodios guardados durante terapia o desde el expediente aparecerán aquí.</p></div>}</section>
    {captureOpen && <ABCQuickCapture context={{ profileId, profileName }} onClose={() => setCaptureOpen(false)} onSaved={load} notify={notify}/>} 
    {categoryOpen && <div className="modal-backdrop"><section className="abc-category-modal" role="dialog" aria-modal="true" aria-labelledby="abc-category-title"><div className="modal-title"><div><p className="section-kicker">Configuración clínica</p><h2 id="abc-category-title">Categorías ABC</h2></div><button aria-label="Cerrar" onClick={() => setCategoryOpen(false)}><X size={19}/></button></div><div className="abc-category-create"><select value={categoryDraft.categoryType} onChange={(event) => setCategoryDraft({ ...categoryDraft, categoryType: event.target.value as Category["categoryType"] })}><option value="antecedent">Antecedente</option><option value="consequence">Consecuencia</option></select><input value={categoryDraft.label} onChange={(event) => setCategoryDraft({ ...categoryDraft, label: event.target.value })} placeholder="Nombre de categoría"/><button className="primary-formation-button" onClick={createCategory}><Plus size={15}/> Agregar</button></div><div className="abc-category-list">{data.categories.map((category) => <article key={category.id}><div><small>{category.categoryType === "antecedent" ? "Antecedente" : "Consecuencia"}</small><strong>{category.label}</strong></div><button className={category.status === "active" ? "active" : ""} onClick={() => setCategoryStatus(category)}>{category.status === "active" ? "Activa" : "Inactiva"}</button></article>)}</div><div className="modal-actions"><button className="secondary-formation-button" onClick={() => setCategoryOpen(false)}>Cerrar</button></div></section></div>}
  </div>;
}
