"use client";

import {
  Archive,
  ArrowLeft,
  CheckCircle2,
  CopyPlus,
  FileCheck2,
  Layers3,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  ShieldAlert,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { useState } from "react";
import type {
  EvaluationArea,
  EvaluationPackageDefinition,
  EvaluationTarget,
  TargetMethod,
} from "../../lib/evaluation-packages";
import { areasForPackage, targetsForPackage } from "../../lib/evaluation-packages";

type Props = {
  packages: EvaluationPackageDefinition[];
  onPackagesChange: (packages: EvaluationPackageDefinition[]) => void;
  notify: (message: string) => void;
};

function clientId() {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function newTarget(index: number): EvaluationTarget {
  return {
    id: clientId(),
    code: `T-${String(index + 1).padStart(2, "0")}`,
    title: "",
    criterion: "",
    methods: ["interview", "verification"],
  };
}

function newArea(index: number): EvaluationArea {
  return {
    key: clientId(),
    label: `Área ${index + 1}`,
    short: "",
    description: "",
    route: "all",
    items: [newTarget(0)],
  };
}

function blankPackage(): EvaluationPackageDefinition {
  return {
    id: "",
    familyId: "",
    name: "",
    objective: "",
    version: 1,
    status: "draft",
    areas: [newArea(0)],
  };
}

function targetCount(pack: EvaluationPackageDefinition) {
  return pack.areas.reduce((total, area) => total + area.items.length, 0);
}

function applicableAreaCount(pack: EvaluationPackageDefinition) {
  return Math.max(areasForPackage(pack, "4A").length, areasForPackage(pack, "4B").length);
}

function applicableTargetCount(pack: EvaluationPackageDefinition) {
  return Math.max(targetsForPackage(pack, "4A").length, targetsForPackage(pack, "4B").length);
}

function statusLabel(status: EvaluationPackageDefinition["status"]) {
  return { active: "Activo", draft: "Borrador", archived: "Archivado" }[status];
}

export default function PackageManager({ packages, onPackagesChange, notify }: Props) {
  const [editor, setEditor] = useState<EvaluationPackageDefinition | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<EvaluationPackageDefinition | null>(null);
  const [deleteText, setDeleteText] = useState("");

  function replacePackage(next: EvaluationPackageDefinition) {
    const exists = packages.some((pack) => pack.id === next.id);
    onPackagesChange(exists ? packages.map((pack) => pack.id === next.id ? next : pack) : [next, ...packages]);
  }

  async function packageRequest(body: Record<string, unknown>, method = "PUT") {
    const response = await fetch("/api/evaluation-packages", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json() as { package?: EvaluationPackageDefinition; error?: string };
    if (!response.ok) throw new Error(data.error || "No se pudo completar la acción.");
    return data.package;
  }

  async function saveDraft() {
    if (!editor) return;
    setSaving(true);
    try {
      const saved = await packageRequest(editor, editor.id ? "PUT" : "POST");
      if (!saved) throw new Error("No se recibió el paquete guardado.");
      replacePackage(saved);
      setEditor(saved);
      notify(editor.id ? "Borrador actualizado." : "Paquete creado como borrador.");
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo guardar el paquete."); }
    finally { setSaving(false); }
  }

  async function publish(pack: EvaluationPackageDefinition) {
    setSaving(true);
    try {
      const saved = await packageRequest({ id: pack.id, action: "publish" });
      if (!saved) throw new Error("No se recibió el paquete publicado.");
      onPackagesChange(packages.map((item) => item.familyId === saved.familyId && item.status === "active"
        ? { ...item, status: "archived" as const }
        : item.id === saved.id ? saved : item));
      setEditor(null);
      notify("Paquete publicado y disponible para nuevas evaluaciones.");
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo publicar."); }
    finally { setSaving(false); }
  }

  async function createVersion(pack: EvaluationPackageDefinition) {
    setSaving(true);
    try {
      const saved = await packageRequest({ id: pack.id, action: "new_version" });
      if (!saved) throw new Error("No se pudo crear la versión.");
      onPackagesChange([saved, ...packages]);
      setEditor(saved);
      notify(`Versión ${saved.version}.0 creada como borrador.`);
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo crear la versión."); }
    finally { setSaving(false); }
  }

  async function archivePackage(pack: EvaluationPackageDefinition) {
    setSaving(true);
    try {
      const saved = await packageRequest({ id: pack.id, action: "archive" });
      if (!saved) throw new Error("No se pudo archivar el paquete.");
      replacePackage(saved);
      notify("Paquete archivado. Las evaluaciones existentes conservan su copia intacta.");
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo archivar."); }
    finally { setSaving(false); }
  }

  async function deletePackage() {
    if (!deleteTarget || deleteText.trim().toUpperCase() !== "ELIMINAR") return;
    setSaving(true);
    try {
      const response = await fetch("/api/evaluation-packages", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: deleteTarget.id }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo eliminar el borrador.");
      onPackagesChange(packages.filter((pack) => pack.id !== deleteTarget.id));
      setDeleteTarget(null);
      setDeleteText("");
      notify("Paquete eliminado; las evaluaciones existentes conservaron su copia.");
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo eliminar el paquete."); }
    finally { setSaving(false); }
  }

  function updateArea(areaIndex: number, patch: Partial<EvaluationArea>) {
    if (!editor) return;
    setEditor({ ...editor, areas: editor.areas.map((area, index) => index === areaIndex ? { ...area, ...patch } : area) });
  }

  function updateTarget(areaIndex: number, targetIndex: number, patch: Partial<EvaluationTarget>) {
    if (!editor) return;
    const area = editor.areas[areaIndex];
    updateArea(areaIndex, { items: area.items.map((target, index) => index === targetIndex ? { ...target, ...patch } : target) });
  }

  function toggleMethod(areaIndex: number, targetIndex: number, method: TargetMethod) {
    if (!editor) return;
    const target = editor.areas[areaIndex].items[targetIndex];
    const methods = target.methods || [];
    updateTarget(areaIndex, targetIndex, {
      methods: methods.includes(method) ? methods.filter((item) => item !== method) : [...methods, method],
    });
  }

  if (editor) {
    const isNew = !editor.id;
    return <>
      <div className="work-header package-editor-header">
        <button className="back-button" onClick={() => setEditor(null)}><ArrowLeft size={17}/> Volver</button>
        <div><p className="section-kicker">{isNew ? "Nuevo instrumento" : `Borrador · versión ${editor.version}.0`}</p><h1>{editor.name || "Crear paquete desde cero"}</h1><p>Define el objetivo, las áreas, los targets y cómo se recopilará la evidencia.</p></div>
        <div className="version-lock"><FileCheck2 size={17}/><span>Estado</span><strong>{statusLabel(editor.status)}</strong></div>
      </div>
      <section className="formation-panel package-basics">
        <div className="package-section-heading"><span><Layers3 size={20}/></span><div><h2>Descripción general</h2><p>Esta información aparecerá al seleccionar el paquete para una evaluación.</p></div></div>
        <div className="package-basic-fields">
          <label><span>Nombre del paquete</span><input maxLength={120} value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} placeholder="Ej. Competencias de supervisión clínica" /></label>
          <label><span>Objetivo principal</span><textarea maxLength={1500} value={editor.objective} onChange={(event) => setEditor({ ...editor, objective: event.target.value })} placeholder="Describe qué competencia evalúa, para qué se utilizarán los resultados y qué cambio se espera comprobar." /></label>
        </div>
      </section>
      <div className="package-area-stack">
        {editor.areas.map((area, areaIndex) => <section className="formation-panel package-area-card" key={area.key}>
          <div className="package-area-head">
            <span>{areaIndex + 1}</span>
            <div><p className="section-kicker">Área {areaIndex + 1}</p><h2>{area.short || "Área sin nombre"}</h2></div>
            {editor.areas.length > 1 && <button className="icon-danger" aria-label={`Eliminar área ${areaIndex + 1}`} onClick={() => setEditor({ ...editor, areas: editor.areas.filter((_, index) => index !== areaIndex) })}><Trash2 size={17}/></button>}
          </div>
          <div className="area-fields">
            <label><span>Nombre del área</span><input value={area.short} onChange={(event) => updateArea(areaIndex, { short: event.target.value })} placeholder="Ej. Medición y decisiones" /></label>
            <label><span>Aplicación</span><select value={area.route || "all"} onChange={(event) => updateArea(areaIndex, { route: event.target.value as EvaluationArea["route"] })}><option value="all">Todas las rutas</option><option value="4A">Solo ruta 4A</option><option value="4B">Solo ruta 4B</option></select></label>
            <label className="field-wide"><span>Descripción del área (opcional)</span><input value={area.description || ""} onChange={(event) => updateArea(areaIndex, { description: event.target.value })} placeholder="Qué dimensión agrupa esta área" /></label>
          </div>
          <div className="targets-heading"><div><Target size={18}/><span><strong>Targets</strong><small>{area.items.length} configurado{area.items.length === 1 ? "" : "s"}</small></span></div><button className="secondary-formation-button" onClick={() => updateArea(areaIndex, { items: [...area.items, newTarget(area.items.length)] })}><Plus size={15}/> Agregar target</button></div>
          <div className="target-stack">
            {area.items.map((target, targetIndex) => <article className="target-editor" key={target.id || `${area.key}-${targetIndex}`}>
              <div className="target-number">{String(targetIndex + 1).padStart(2, "0")}</div>
              <div className="target-fields">
                <label><span>Código</span><input maxLength={24} value={target.code} onChange={(event) => updateTarget(areaIndex, targetIndex, { code: event.target.value.toUpperCase() })} /></label>
                <label><span>Nombre del target</span><input maxLength={140} value={target.title} onChange={(event) => updateTarget(areaIndex, targetIndex, { title: event.target.value })} placeholder="Conducta profesional observable" /></label>
                <label className="field-wide"><span>Criterio observable</span><textarea maxLength={1200} value={target.criterion} onChange={(event) => updateTarget(areaIndex, targetIndex, { criterion: event.target.value })} placeholder="Define exactamente qué debe demostrar la persona para registrar 1." /></label>
                <div className="field-wide method-picker"><span>Métodos de recolección de datos</span><div>
                  <button type="button" aria-pressed={(target.methods || []).includes("interview")} className={(target.methods || []).includes("interview") ? "selected" : ""} onClick={() => toggleMethod(areaIndex, targetIndex, "interview")}><CheckCircle2 size={15}/><strong>Entrevista</strong><small>1 · 0 · SE</small></button>
                  <button type="button" aria-pressed={(target.methods || []).includes("verification")} className={(target.methods || []).includes("verification") ? "selected" : ""} onClick={() => toggleMethod(areaIndex, targetIndex, "verification")}><CheckCircle2 size={15}/><strong>Verificación</strong><small>1 · 0 · SO</small></button>
                </div></div>
                <label className="critical-toggle field-wide"><input type="checkbox" checked={Boolean(target.alert)} onChange={(event) => updateTarget(areaIndex, targetIndex, { alert: event.target.checked })}/><ShieldAlert size={16}/><span>Marcar como target crítico para priorizarlo en el plan de enseñanza.</span></label>
              </div>
              {area.items.length > 1 && <button className="icon-danger target-delete" aria-label={`Eliminar target ${target.code || targetIndex + 1}`} onClick={() => updateArea(areaIndex, { items: area.items.filter((_, index) => index !== targetIndex) })}><Trash2 size={16}/></button>}
            </article>)}
          </div>
        </section>)}
      </div>
      <button className="add-area-button" onClick={() => setEditor({ ...editor, areas: [...editor.areas, newArea(editor.areas.length)] })}><Plus size={18}/><span><strong>Agregar otra área</strong><small>Cada área puede contener sus propios targets y métodos de recolección.</small></span></button>
      <div className="sticky-actions"><div><strong>{editor.areas.length} áreas · {targetCount(editor)} targets</strong><small>Los códigos deben ser únicos y cada target necesita al menos un método.</small></div><button className="primary-formation-button" disabled={saving} onClick={saveDraft}>{saving ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>} {isNew ? "Crear borrador" : "Guardar borrador"}</button>{editor.id && <button className="secondary-formation-button publish-button" disabled={saving} onClick={() => publish(editor)}><FileCheck2 size={16}/> Publicar paquete</button>}</div>
    </>;
  }

  const activeCount = packages.filter((pack) => pack.status === "active").length;
  const draftCount = packages.filter((pack) => pack.status === "draft").length;
  return <>
    <div className="formation-heading"><div><p className="section-kicker">Biblioteca de instrumentos</p><h1>Paquetes de evaluación</h1><p>Crea paquetes desde cero y utilízalos directamente en nuevas evaluaciones.</p></div><button className="primary-formation-button" onClick={() => setEditor(blankPackage())}><Plus size={17}/> Crear paquete</button></div>
    <section className="package-workflow-note"><Layers3 size={21}/><div><strong>Objetivo → áreas → targets → métodos → publicación</strong><p>Los borradores pueden editarse. Al publicar, la versión queda protegida; cualquier cambio posterior se realiza en una versión nueva para no alterar las evaluaciones ya iniciadas.</p></div></section>
    <div className="package-library-metrics"><article><span><FileCheck2 size={19}/></span><div><small>Paquetes activos</small><strong>{activeCount}</strong></div></article><article><span><Pencil size={19}/></span><div><small>Borradores</small><strong>{draftCount}</strong></div></article><article><span><Target size={19}/></span><div><small>Targets activos</small><strong>{packages.filter((pack) => pack.status === "active").reduce((total, pack) => total + applicableTargetCount(pack), 0)}</strong></div></article></div>
    <section className="package-library-grid">
      {packages.map((pack) => <article className="formation-panel package-library-card" key={pack.id}>
        <div className="package-card-top"><span className={`package-status ${pack.status}`}>{statusLabel(pack.status)}</span><span>v{pack.version}.0</span></div>
        <div className="package-card-icon"><Layers3 size={22}/></div><h2>{pack.name}</h2><p>{pack.objective}</p>
        <div className="package-card-stats"><span><strong>{applicableAreaCount(pack)}</strong> áreas por ruta</span><span><strong>{applicableTargetCount(pack)}</strong> targets por ruta</span><span><strong>1/0</strong> + códigos especiales</span></div>
        <div className="package-card-actions">
          {pack.status === "draft" ? <><button onClick={() => setEditor(structuredClone(pack))}><Pencil size={15}/> Editar</button><button onClick={() => publish(pack)}><FileCheck2 size={15}/> Publicar</button></> : <><button onClick={() => createVersion(pack)}><CopyPlus size={15}/> Editar nueva versión</button>{pack.status === "active" && <button onClick={() => archivePackage(pack)}><Archive size={15}/> Archivar</button>}</>}<button className="danger-action" onClick={() => { setDeleteTarget(pack); setDeleteText(""); }}><Trash2 size={15}/> Eliminar</button>
        </div>
      </article>)}
    </section>
    {deleteTarget && <div className="modal-backdrop"><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-package-title"><button className="modal-x" aria-label="Cerrar" onClick={() => setDeleteTarget(null)}><X size={18}/></button><span className="danger-mark"><Trash2 size={23}/></span><h2 id="delete-package-title">Eliminar paquete permanentemente</h2><p>Se eliminará <strong>{deleteTarget.name}</strong> de la biblioteca. Las evaluaciones ya creadas conservarán su copia inmutable del instrumento.</p><label><span>Escribe ELIMINAR para confirmar</span><input autoFocus value={deleteText} onChange={(event) => setDeleteText(event.target.value)}/></label><div><button className="secondary-formation-button" onClick={() => setDeleteTarget(null)}>Cancelar</button><button className="danger-button" disabled={saving || deleteText.trim().toUpperCase() !== "ELIMINAR"} onClick={deletePackage}><Trash2 size={16}/> Eliminar permanentemente</button></div></section></div>}
  </>;
}
