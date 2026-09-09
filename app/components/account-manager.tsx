"use client";

import { Ban, CheckCircle2, Copy, Edit3, KeyRound, LoaderCircle, Plus, ShieldCheck, Trash2, UserRoundCheck, UsersRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { roleLabel, type AppRole } from "../../lib/access-control";
import type { PersonnelProfile } from "./personnel-profile-manager";

type AccountRow = {
  id: string;
  auth_user_id: string | null;
  email: string;
  username: string;
  display_name: string;
  role: AppRole;
  status: "invited" | "active" | "suspended";
  personnel_profile_id: string | null;
  site_scope: string[];
  assignedProfileIds: string[];
  activationState: "activated" | "pending";
};

type AccountForm = {
  id?: string;
  activated?: boolean;
  displayName: string;
  username: string;
  email: string;
  role: AppRole;
  siteScope: string[];
  assignedProfileIds: string[];
};

const blankForm = (): AccountForm => ({ displayName: "", username: "", email: "", role: "coordinador", siteScope: [], assignedProfileIds: [] });

export default function AccountManager({ profiles, sites, currentRole, notify }: { profiles: PersonnelProfile[]; sites: string[]; currentRole: AppRole; notify: (message: string) => void }) {
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<AccountForm | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AccountRow | null>(null);
  const activeProfiles = useMemo(() => profiles.filter((profile) => profile.status === "active"), [profiles]);

  async function load() {
    setLoading(true);
    const response = await fetch("/api/accounts", { cache: "no-store" });
    const data = await response.json() as { accounts?: AccountRow[]; error?: string };
    if (!response.ok) notify(data.error || "No se pudieron cargar las cuentas.");
    setAccounts(data.accounts || []);
    setLoading(false);
  }
  useEffect(() => {
    let cancelled = false;
    fetch("/api/accounts", { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() as { accounts?: AccountRow[]; error?: string } }))
      .then(({ response, data }) => {
        if (cancelled) return;
        if (!response.ok) notify(data.error || "No se pudieron cargar las cuentas.");
        setAccounts(data.accounts || []);
      })
      .catch(() => { if (!cancelled) notify("No se pudieron cargar las cuentas."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // The initial request belongs to the mounted account module.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function edit(account: AccountRow) {
    setForm({
      id: account.id,
      activated: Boolean(account.auth_user_id),
      displayName: account.display_name,
      username: account.username,
      email: account.email,
      role: account.role,
      siteScope: account.site_scope || [],
      assignedProfileIds: account.assignedProfileIds || [],
    });
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    const response = await fetch("/api/accounts", {
      method: form.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await response.json() as { error?: string };
    setBusy(false);
    if (!response.ok) return notify(data.error || "No se pudo guardar la cuenta.");
    setForm(null);
    notify(form.id ? "Cuenta actualizada." : "Cuenta autorizada. Comparte el enlace de activación con la persona.");
    await load();
  }

  async function accountAction(account: AccountRow, action: "suspend" | "activate") {
    setBusy(true);
    const response = await fetch("/api/accounts", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: account.id, action }) });
    const data = await response.json() as { error?: string };
    setBusy(false);
    if (!response.ok) return notify(data.error || "No se pudo cambiar el acceso.");
    notify(action === "suspend" ? "Acceso suspendido inmediatamente." : "Acceso habilitado.");
    await load();
  }

  async function remove() {
    if (!deleteTarget) return;
    setBusy(true);
    const response = await fetch("/api/accounts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: deleteTarget.id }) });
    const data = await response.json() as { error?: string };
    setBusy(false);
    if (!response.ok) return notify(data.error || "No se pudo revocar la cuenta.");
    setDeleteTarget(null);
    notify("Cuenta revocada. Los datos clínicos asociados se conservaron.");
    await load();
  }

  async function copyActivation() {
    await navigator.clipboard.writeText(`${window.location.origin}/registro`);
    notify("Enlace de activación copiado.");
  }

  return <>
    <div className="formation-heading accounts-heading"><div><p className="section-kicker">Identidad y alcance</p><h1>Cuentas de acceso</h1><p>Autoriza a cada profesional, delimita sus sedes y asigna los niños que podrá consultar o intervenir.</p></div><button className="primary-formation-button" onClick={() => setForm(blankForm())}><Plus size={16}/> Nueva cuenta</button></div>
    <section className="accounts-summary">
      <article><span><UsersRound size={19}/></span><div><small>Cuentas</small><strong>{accounts.length}</strong></div></article>
      <article><span><UserRoundCheck size={19}/></span><div><small>Activas</small><strong>{accounts.filter((item) => item.status === "active").length}</strong></div></article>
      <article><span><KeyRound size={19}/></span><div><small>Pendientes</small><strong>{accounts.filter((item) => item.activationState === "pending").length}</strong></div></article>
      <button onClick={copyActivation}><Copy size={16}/> Copiar enlace de activación</button>
    </section>
    <section className="formation-panel accounts-panel">
      {loading ? <div className="intervention-empty"><LoaderCircle className="spin" size={28}/><strong>Cargando cuentas…</strong></div> : accounts.length ? <div className="accounts-table">
        <div className="accounts-table-head"><span>Usuario</span><span>Rol y alcance</span><span>Estado</span><span>Acciones</span></div>
        {accounts.map((account) => <article key={account.id}>
          <div className="account-identity"><span>{account.display_name.split(" ").map((part) => part[0]).join("").slice(0,2).toUpperCase()}</span><div><strong>{account.display_name}</strong><small>@{account.username} · {account.email}</small></div></div>
          <div className="account-scope"><strong>{roleLabel(account.role)}</strong><small>{account.role === "direccion_clinica" ? "Control institucional" : account.role === "subdirector" ? `Institución · ${account.assignedProfileIds.length} niño${account.assignedProfileIds.length === 1 ? "" : "s"} vinculado${account.assignedProfileIds.length === 1 ? "" : "s"}` : account.role === "supervisor" ? `${account.site_scope.length} sede${account.site_scope.length === 1 ? "" : "s"} · ${account.assignedProfileIds.length} niño${account.assignedProfileIds.length === 1 ? "" : "s"}` : `${account.assignedProfileIds.length} niño${account.assignedProfileIds.length === 1 ? "" : "s"} asignado${account.assignedProfileIds.length === 1 ? "" : "s"}`}</small></div>
          <div className="account-status"><span className={`account-status-chip ${account.status}`}>{account.status === "suspended" ? "Suspendida" : account.activationState === "pending" ? "Pendiente" : "Activa"}</span><small>{account.auth_user_id ? "Identidad verificada" : "Sin activar"}</small></div>
          <div className="account-actions">{account.role === "direccion_clinica" && currentRole !== "direccion_clinica" ? <span className="protected-account"><ShieldCheck size={16}/> Protegida</span> : <><button aria-label="Editar cuenta" title="Editar" onClick={() => edit(account)}><Edit3 size={16}/></button>{account.status === "suspended" ? <button aria-label="Activar cuenta" title="Activar" onClick={() => accountAction(account, "activate")}><CheckCircle2 size={16}/></button> : <button aria-label="Suspender cuenta" title="Suspender" onClick={() => accountAction(account, "suspend")}><Ban size={16}/></button>}<button className="danger-action" aria-label="Revocar cuenta" title="Revocar" onClick={() => setDeleteTarget(account)}><Trash2 size={16}/></button></>}</div>
        </article>)}
      </div> : <div className="intervention-empty"><ShieldCheck size={30}/><strong>Aún no hay cuentas adicionales</strong><p>Tu cuenta propietaria se mostrará después de activarla.</p></div>}
    </section>
    {form && <div className="modal-backdrop"><section className="account-modal" role="dialog" aria-modal="true" aria-labelledby="account-modal-title">
      <div className="modal-title"><div><p className="section-kicker">{form.id ? "Editar autorización" : "Nueva autorización"}</p><h2 id="account-modal-title">{form.id ? "Actualizar cuenta" : "Crear cuenta de acceso"}</h2></div><button aria-label="Cerrar" onClick={() => setForm(null)}><X size={19}/></button></div>
      <div className="account-form-grid">
        <label><span>Nombre completo</span><input autoFocus value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })}/></label>
        <label><span>Nombre de usuario</span><input value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} placeholder="nombre.apellido"/></label>
        <label className="field-wide"><span>Correo para iniciar sesión</span><input type="email" disabled={form.activated} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })}/>{form.activated && <small>Para proteger la identidad verificada, este correo ya no puede modificarse.</small>}</label>
        <label><span>Rol</span><select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as AppRole, siteScope: [], assignedProfileIds: [] })}>{currentRole === "direccion_clinica" && <option value="direccion_clinica">Dirección Clínica</option>}<option value="subdirector">Subdirector clínico</option><option value="supervisor">Supervisor clínico</option><option value="coordinador">Coordinador clínico</option><option value="terapeuta">Terapeuta clínico</option></select></label>
      </div>
      {form.role === "supervisor" && <fieldset className="account-scope-field"><legend>Sedes autorizadas</legend><div>{sites.map((site) => <label key={site}><input type="checkbox" checked={form.siteScope.includes(site)} onChange={(event) => setForm({ ...form, siteScope: event.target.checked ? [...form.siteScope, site] : form.siteScope.filter((item) => item !== site) })}/><span>{site}</span></label>)}</div></fieldset>}
      {form.role !== "direccion_clinica" && <fieldset className="account-scope-field profile-scope"><legend>Niños vinculados</legend><div>{activeProfiles.map((profile) => <label key={profile.id}><input type="checkbox" checked={form.assignedProfileIds.includes(profile.id)} onChange={(event) => setForm({ ...form, assignedProfileIds: event.target.checked ? [...form.assignedProfileIds, profile.id] : form.assignedProfileIds.filter((item) => item !== profile.id) })}/><span><strong>{profile.fullName}</strong><small>{profile.site}{profile.internalCode ? ` · ${profile.internalCode}` : ""}</small></span></label>)}</div></fieldset>}
      <div className="account-role-note"><ShieldCheck size={18}/><p>{form.role === "direccion_clinica" ? "Control institucional completo y configuración de permisos por rol." : form.role === "subdirector" ? "Acceso institucional según los permisos definidos y vinculación clínica con niños específicos." : form.role === "supervisor" ? "Acceso limitado a sus sedes y a los niños vinculados." : form.role === "coordinador" ? "Acceso limitado a los niños asignados y a los permisos configurados para Coordinación." : "Acceso limitado a los niños asignados y a los permisos configurados para Terapia."}</p></div>
      <div className="modal-actions"><button className="secondary-formation-button" onClick={() => setForm(null)}>Cancelar</button><button className="primary-formation-button" disabled={busy} onClick={save}>{busy ? <LoaderCircle className="spin" size={16}/> : <ShieldCheck size={16}/>} Guardar autorización</button></div>
    </section></div>}
    {deleteTarget && <div className="modal-backdrop"><section className="confirm-modal" role="alertdialog" aria-modal="true"><span className="danger-mark"><Trash2 size={23}/></span><h2>Revocar acceso</h2><p><strong>{deleteTarget.display_name}</strong> perderá acceso inmediatamente. Sus evaluaciones, programas, sesiones y gráficas se conservarán.</p><div><button className="secondary-formation-button" onClick={() => setDeleteTarget(null)}>Cancelar</button><button className="danger-button" disabled={busy} onClick={remove}>Revocar cuenta</button></div></section></div>}
  </>;
}
