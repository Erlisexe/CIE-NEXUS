"use client";

import ModalLayer from "./modal-layer";

import { Archive, Building2, Edit3, LoaderCircle, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

export type SiteRow = {
  id: string;
  name: string;
  code: string;
  status: "active" | "inactive";
  usage?: { children: number; evaluations: number; programs: number; appointments: number; accounts: number };
};

export default function SiteManager({ canManage, notify, onSitesChange }: { canManage: boolean; notify: (message: string) => void; onSitesChange: (sites: SiteRow[]) => void }) {
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<{ id?: string; name: string; code: string } | null>(null);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/sites", { cache: "no-store" });
      const data = await response.json() as { sites?: SiteRow[]; error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudieron cargar las sedes.");
      setSites(data.sites || []);
      onSitesChange(data.sites || []);
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudieron cargar las sedes."); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/sites", { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() as { sites?: SiteRow[]; error?: string } }))
      .then(({ response, data }) => {
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || "No se pudieron cargar las sedes.");
        setSites(data.sites || []);
        onSitesChange(data.sites || []);
      })
      .catch((error: Error) => { if (!cancelled) notify(error.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // This module owns its initial directory request.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const response = await fetch("/api/sites", { method: draft.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo guardar la sede.");
      setDraft(null);
      notify(draft.id ? "Sede actualizada." : "Sede creada y disponible para nuevos registros.");
      await load();
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo guardar la sede."); }
    finally { setSaving(false); }
  }

  async function changeStatus(site: SiteRow) {
    setSaving(true);
    try {
      const response = await fetch("/api/sites", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: site.id, action: site.status === "active" ? "deactivate" : "activate" }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo cambiar el estado de la sede.");
      notify(site.status === "active" ? "Sede desactivada; sus historiales permanecen intactos." : "Sede reactivada.");
      await load();
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo actualizar la sede."); }
    finally { setSaving(false); }
  }

  async function remove(site: SiteRow) {
    if (!window.confirm(`Eliminar ${site.name}? Solo será posible si nunca tuvo registros vinculados.`)) return;
    setSaving(true);
    try {
      const response = await fetch("/api/sites", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: site.id }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo eliminar la sede.");
      notify("Sede sin historial eliminada.");
      await load();
    } catch (error) { notify(error instanceof Error ? error.message : "No se pudo eliminar la sede."); }
    finally { setSaving(false); }
  }

  return <>
    <div className="formation-heading"><div><p className="section-kicker">Estructura institucional</p><h1>Administración de sedes</h1><p>Desactiva las sedes con historial y elimina únicamente las que nunca tuvieron registros vinculados.</p></div>{canManage && <button className="primary-formation-button" onClick={() => setDraft({ name: "", code: "" })}><Plus size={16}/> Nueva sede</button>}</div>
    {loading ? <section className="formation-panel site-manager-empty"><LoaderCircle className="spin" size={27}/><strong>Cargando sedes…</strong></section> : <div className="site-manager-grid">{sites.map((site) => {
      const usage = site.usage;
      const linked = usage ? Object.values(usage).reduce((total, value) => total + value, 0) : 0;
      return <article className={`formation-panel site-manager-card ${site.status}`} key={site.id}><header><span><Building2 size={21}/></span><div><small>{site.code}</small><h2>{site.name}</h2></div><em>{site.status === "active" ? "Activa" : "Inactiva"}</em></header><div className="site-usage-grid"><div><strong>{usage?.children || 0}</strong><small>Niños</small></div><div><strong>{usage?.appointments || 0}</strong><small>Agenda</small></div><div><strong>{usage?.accounts || 0}</strong><small>Cuentas</small></div></div><p>{linked ? "La sede conserva relaciones activas o históricas; no puede eliminarse físicamente." : "Sin registros vinculados. Puede eliminarse de forma segura si no se utilizará."}</p>{canManage && <footer><button onClick={() => setDraft({ id: site.id, name: site.name, code: site.code })}><Edit3 size={14}/> Editar</button><button onClick={() => changeStatus(site)}>{site.status === "active" ? <><Archive size={14}/> Desactivar</> : <><RotateCcw size={14}/> Reactivar</>}</button>{!linked && <button className="danger-action" onClick={() => remove(site)}><Trash2 size={14}/> Eliminar</button>}</footer>}</article>;
    })}</div>}
    {draft && <ModalLayer onDismiss={() => setDraft(null)} className="modal-backdrop"><section className="site-modal" role="dialog" aria-modal="true"><div className="modal-title"><div><p className="section-kicker">Sede CIE</p><h2>{draft.id ? "Editar sede" : "Crear sede"}</h2></div><button aria-label="Cerrar" onClick={() => setDraft(null)}><X size={19}/></button></div><div className="site-form-grid"><label><span>Nombre</span><input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Ej. Managua Centro"/></label><label><span>Código</span><input value={draft.code} onChange={(event) => setDraft({ ...draft, code: event.target.value })} placeholder="MGC" maxLength={12}/></label></div><div className="modal-actions"><button className="secondary-formation-button" onClick={() => setDraft(null)}>Cancelar</button><button className="primary-formation-button" disabled={saving || !draft.name.trim() || !draft.code.trim()} onClick={save}>{saving ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>} Guardar sede</button></div></section></ModalLayer>}
  </>;
}
