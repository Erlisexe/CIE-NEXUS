"use client";

import { StartTodaySessionButton } from "./today-session-launcher";

import ModalLayer from "./modal-layer";

import {
  Archive,
  Building2,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  Edit3,
  FolderOpen,
  LoaderCircle,
  Play,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { roleLabel, type AppRole } from "../../lib/access-control";
import ChildProfileWorkspace from "./child-profile-workspace";
import ProfilePhoto from "./profile-photo";

export type LinkableAccount = {
  id: string;
  displayName: string;
  role: AppRole;
  status: string;
};

type ResponsibleAccountIds = {
  coordinador: string | null;
  supervisor: string | null;
  subdirector: string | null;
};

export type PersonnelProfile = {
  id: string;
  fullName: string;
  role: string;
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
  customFields: Array<{ id: string; label: string; value: string }>;
  notes: string;
  status: "active" | "archived";
  evaluationCount: number;
  programCount: number;
  sessionCount: number;
  responsibleAccountIds?: ResponsibleAccountIds;
  responsibles?: LinkableAccount[];
  createdAt: string;
  updatedAt: string;
  photoUrl?: string | null;
};

type ChildDraft = Pick<PersonnelProfile, "fullName" | "site" | "internalCode" | "dateOfBirth" | "diagnosis" | "address" | "phone" | "guardianName" | "guardianPhone" | "preferredLanguage" | "emergencyContact" | "customFields" | "notes"> & {
  id?: string;
  responsibleAccountIds: ResponsibleAccountIds;
};

const emptyResponsibles = (): ResponsibleAccountIds => ({ coordinador: null, supervisor: null, subdirector: null });

function blankChild(site = "León"): ChildDraft {
  return { fullName: "", site, internalCode: "", dateOfBirth: "", diagnosis: "", address: "", phone: "", guardianName: "", guardianPhone: "", preferredLanguage: "", emergencyContact: "", customFields: [], notes: "", responsibleAccountIds: emptyResponsibles() };
}

export default function PersonnelProfileManager({
  profiles,
  sites,
  linkableAccounts,
  canManage,
  selectedProfileId,
  selectedSite,
  onSelectSite,
  onSelect,
  onProfilesChange,
  onOpenPrograms,
  onOpenEvaluations,
  onOpenSessions,
  onStartTodaySession,
  onOpenGraphs,
  onOpenProgramGraph,
  onOpenABC,
  onOpenReports,
  notify,
}: {
  profiles: PersonnelProfile[];
  sites: string[];
  linkableAccounts: LinkableAccount[];
  canManage: boolean;
  selectedProfileId: string;
  selectedSite?: string;
  onSelectSite?: (site: string) => void;
  onSelect: (id: string) => void;
  onProfilesChange: (profiles: PersonnelProfile[]) => void;
  onOpenPrograms: () => void;
  onOpenEvaluations: () => void;
  onOpenSessions: () => void;
  onStartTodaySession?: (profileId: string) => void;
  onOpenGraphs: () => void;
  onOpenProgramGraph: (programId: string) => void;
  onOpenABC: () => void;
  onOpenReports: () => void;
  notify: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [localSite, setLocalSite] = useState("Todas");
  const site = selectedSite ?? localSite;
  const setSite = onSelectSite || setLocalSite;
  const [showArchived, setShowArchived] = useState(false);
  const [draft, setDraft] = useState<ChildDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PersonnelProfile | null>(null);
  const [deleteText, setDeleteText] = useState("");

  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("es");
    return profiles.filter((profile) => {
      const matchesStatus = showArchived ? profile.status === "archived" : profile.status === "active";
      const matchesSite = site === "Todas" || profile.site === site;
      const responsibleNames = (profile.responsibles || []).map((item) => item.displayName).join(" ");
      const matchesText = !needle || [profile.fullName, profile.site, profile.internalCode, responsibleNames].some((value) => value.toLocaleLowerCase("es").includes(needle));
      return matchesStatus && matchesSite && matchesText;
    });
  }, [profiles, query, site, showArchived]);

  function openEdit(profile: PersonnelProfile) {
    setDraft({
      id: profile.id,
      fullName: profile.fullName,
      site: profile.site,
      internalCode: profile.internalCode,
      dateOfBirth: profile.dateOfBirth || "",
      diagnosis: profile.diagnosis || "",
      address: profile.address || "",
      phone: profile.phone || "",
      guardianName: profile.guardianName || "",
      guardianPhone: profile.guardianPhone || "",
      preferredLanguage: profile.preferredLanguage || "",
      emergencyContact: profile.emergencyContact || "",
      customFields: profile.customFields || [],
      notes: profile.notes,
      responsibleAccountIds: profile.responsibleAccountIds || emptyResponsibles(),
    });
  }

  async function saveChild() {
    if (!draft?.fullName.trim()) return notify("Escribe el nombre del niño.");
    setSaving(true);
    try {
      const response = await fetch("/api/personnel-profiles", {
        method: draft.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const data = await response.json() as { profile?: PersonnelProfile; error?: string };
      if (!response.ok || !data.profile) throw new Error(data.error || "No se pudo guardar el niño.");
      const current = profiles.find((profile) => profile.id === data.profile?.id);
      const selectedIds = data.profile.responsibleAccountIds || draft.responsibleAccountIds;
      const responsibles = linkableAccounts.filter((item) => Object.values(selectedIds).includes(item.id));
      const complete = { ...current, ...data.profile, role: "Niño", responsibleAccountIds: selectedIds, responsibles } as PersonnelProfile;
      onProfilesChange(draft.id ? profiles.map((profile) => profile.id === complete.id ? complete : profile) : [complete, ...profiles]);
      onSelect(complete.id);
      setDraft(null);
      notify(draft.id ? "Niño actualizado; sus registros conservan la vinculación." : "Niño creado y seleccionado.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo guardar el niño.");
    } finally { setSaving(false); }
  }

  async function changeStatus(profile: PersonnelProfile, action: "archive" | "restore") {
    setSaving(true);
    try {
      const response = await fetch("/api/personnel-profiles", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: profile.id, action }) });
      const data = await response.json() as { profile?: PersonnelProfile; error?: string };
      if (!response.ok || !data.profile) throw new Error(data.error || "No se pudo actualizar el niño.");
      onProfilesChange(profiles.map((item) => item.id === profile.id ? { ...item, ...data.profile } : item));
      if (action === "archive" && selectedProfileId === profile.id) onSelect("all");
      notify(action === "archive" ? "Niño archivado; sus datos permanecen intactos." : "Niño restaurado.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo actualizar el niño.");
    } finally { setSaving(false); }
  }

  async function deleteChild() {
    if (!deleteTarget || deleteText.trim().toUpperCase() !== "ELIMINAR") return;
    setSaving(true);
    try {
      const response = await fetch("/api/personnel-profiles", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: deleteTarget.id }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo eliminar el niño.");
      onProfilesChange(profiles.filter((profile) => profile.id !== deleteTarget.id));
      if (selectedProfileId === deleteTarget.id) onSelect("all");
      setDeleteTarget(null);
      setDeleteText("");
      notify("Niño y todos sus registros asociados fueron eliminados.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo eliminar el niño.");
    } finally { setSaving(false); }
  }

  const roleOptions = (role: AppRole) => linkableAccounts.filter((item) => item.role === role);
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId && (site === "Todas" || profile.site === site)) || null;

  return <>
    {selectedProfile ? <ChildProfileWorkspace key={selectedProfile.id} profile={selectedProfile} canManage={canManage} onBack={() => onSelect("all")} onEdit={() => openEdit(selectedProfile)} onOpenEvaluations={onOpenEvaluations} onOpenPrograms={onOpenPrograms} onOpenSessions={onOpenSessions} onStartTodaySession={onStartTodaySession} onOpenGraphs={onOpenGraphs} onOpenProgramGraph={onOpenProgramGraph} onOpenABC={onOpenABC} onOpenReports={onOpenReports} onPhotoChange={(photoUrl) => onProfilesChange(profiles.map((item) => item.id === selectedProfile.id ? { ...item, photoUrl } : item))} notify={notify}/> : <>
    <div className="formation-heading">
      <div><p className="section-kicker">Directorio clínico</p><h1>Niños organizados por sede</h1><p>Cada niño reúne sus evaluaciones, programas y sesiones, con responsables clínicos claramente vinculados.</p></div>
      {canManage && <button className="primary-formation-button" onClick={() => setDraft(blankChild(site === "Todas" ? sites[0] || "León" : site))}><Plus size={17}/> Agregar niño</button>}
    </div>

    <section className="profile-scope-note"><UserRound size={21}/><div><strong>Un niño es un caso clínico, no una cuenta de acceso.</strong><p>Puede vincularse con un Coordinador, un Supervisor y un Subdirector; los permisos del profesional continúan limitando lo que podrá hacer.</p></div></section>

    <section className="profile-toolbar" aria-label="Filtros de niños">
      <label><span className="sr-only">Buscar niño</span><Search size={17}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre, responsable o código"/></label>
      <select aria-label="Filtrar niños por sede" value={site} onChange={(event) => setSite(event.target.value)}><option value="Todas">Todas las sedes</option>{sites.map((item) => <option value={item} key={item}>{item}</option>)}</select>
      <div className="profile-status-toggle" role="group" aria-label="Estado del niño"><button className={!showArchived ? "selected" : ""} onClick={() => setShowArchived(false)}>Activos</button><button className={showArchived ? "selected" : ""} onClick={() => setShowArchived(true)}>Archivados</button></div>
      <span>{visible.length} niño{visible.length === 1 ? "" : "s"}</span>
    </section>

    {visible.length ? <div className="profile-site-sections">{sites.map((siteName) => {
      const siteProfiles = visible.filter((profile) => profile.site === siteName);
      if (!siteProfiles.length) return null;
      return <section className="profile-site-group" key={siteName}><header><div><Building2 size={18}/><div><small>Sede</small><h2>{siteName}</h2></div></div><span>{siteProfiles.length} niño{siteProfiles.length === 1 ? "" : "s"}</span></header><div className="person-profile-grid">{siteProfiles.map((profile) => <article className={`person-profile-card ${selectedProfileId === profile.id ? "selected" : ""}`} key={profile.id}>
        <div className="profile-card-head"><ProfilePhoto name={profile.fullName} src={profile.photoUrl} avatarClassName="child-list-avatar"/><div><h3>{profile.fullName}</h3><p>{profile.internalCode || `Sede ${profile.site}`}</p></div>{canManage && <button aria-label={`Editar a ${profile.fullName}`} onClick={() => openEdit(profile)}><Edit3 size={16}/></button>}</div>
        <div className="profile-counts"><div><strong>{profile.evaluationCount || 0}</strong><small>Evaluaciones</small></div><div><strong>{profile.programCount || 0}</strong><small>Programas</small></div><div><strong>{profile.sessionCount || 0}</strong><small>Sesiones</small></div></div>
        {(profile.responsibles || []).length > 0 && <div className="child-responsibles">{profile.responsibles?.map((responsible) => <span key={responsible.id}><strong>{roleLabel(responsible.role)}</strong>{responsible.displayName}</span>)}</div>}
        {profile.notes && <p className="profile-notes">{profile.notes}</p>}
        {profile.status === "active" && onStartTodaySession && <StartTodaySessionButton className="primary-formation-button child-start-session" onClick={() => onStartTodaySession(profile.id)}/>}
        <footer>{profile.status === "active" ? <><button className="profile-open" onClick={() => onSelect(profile.id)}><FolderOpen size={15}/> Abrir expediente</button>{canManage && <button title="Archivar niño" aria-label={`Archivar a ${profile.fullName}`} onClick={() => changeStatus(profile, "archive")}><Archive size={15}/></button>}</> : canManage ? <button className="profile-open" onClick={() => changeStatus(profile, "restore")}><RotateCcw size={15}/> Restaurar</button> : null}{canManage && <button className="danger-action" title="Eliminar niño" aria-label={`Eliminar a ${profile.fullName}`} onClick={() => { setDeleteTarget(profile); setDeleteText(""); }}><Trash2 size={15}/></button>}</footer>
      </article>)}</div></section>;
    })}</div> : <div className="intervention-empty"><CircleDashed size={30}/><strong>{showArchived ? "No hay niños archivados" : "Aún no hay niños en esta vista"}</strong><p>{canManage ? "Agrega el primer niño para vincularle evaluaciones, programas y sesiones." : "No hay niños disponibles dentro de tu alcance actual."}</p>{canManage && <button className="primary-formation-button" onClick={() => setDraft(blankChild(site === "Todas" ? sites[0] || "León" : site))}><Plus size={16}/> Agregar primer niño</button>}</div>}

    {selectedProfileId !== "all" && profiles.some((profile) => profile.id === selectedProfileId) && <section className="selected-profile-actions"><CheckCircle2 size={20}/><div><strong>Niño seleccionado</strong><p>Las nuevas evaluaciones, programas y sesiones se asignarán a este niño.</p></div><button onClick={onOpenEvaluations}><ClipboardCheck size={15}/> Evaluaciones</button><button onClick={onOpenPrograms}><Play size={15}/> Programas</button></section>}
    </>}

    {draft && <ModalLayer onDismiss={() => setDraft(null)} className="modal-backdrop"><section className="profile-modal" role="dialog" aria-modal="true" aria-labelledby="child-modal-title"><div className="modal-title"><div><p className="section-kicker">Caso clínico</p><h2 id="child-modal-title">{draft.id ? "Editar niño" : "Agregar niño"}</h2></div><button aria-label="Cerrar" onClick={() => setDraft(null)}><X size={19}/></button></div><p className="modal-intro">Este registro organiza la información clínica del niño. Los profesionales vinculados necesitan además los permisos correspondientes a su rol.</p><div className="profile-form-grid">
      <label className="field-wide"><span>Nombre completo</span><input autoFocus value={draft.fullName} onChange={(event) => setDraft({ ...draft, fullName: event.target.value })} placeholder="Nombre y apellido"/></label>
      <label><span>Sede</span><select value={draft.site} onChange={(event) => setDraft({ ...draft, site: event.target.value })}>{sites.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label><span>Código interno (opcional)</span><input value={draft.internalCode} onChange={(event) => setDraft({ ...draft, internalCode: event.target.value })} placeholder="Ej. NNA-LE-001"/></label>
      <label><span>Fecha de nacimiento</span><input type="date" value={draft.dateOfBirth} onChange={(event) => setDraft({ ...draft, dateOfBirth: event.target.value })}/></label>
      <label><span>Diagnóstico</span><input value={draft.diagnosis} onChange={(event) => setDraft({ ...draft, diagnosis: event.target.value })} placeholder="Diagnóstico clínico (opcional)"/></label>
      <label className="field-wide"><span>Dirección</span><input value={draft.address} onChange={(event) => setDraft({ ...draft, address: event.target.value })} placeholder="Dirección de residencia"/></label>
      <label><span>Teléfono</span><input type="tel" value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} placeholder="Número de teléfono"/></label>
      <label><span>Idioma preferido</span><input value={draft.preferredLanguage} onChange={(event) => setDraft({ ...draft, preferredLanguage: event.target.value })} placeholder="Ej. Español"/></label>
      <label><span>Madre, padre o tutor</span><input value={draft.guardianName} onChange={(event) => setDraft({ ...draft, guardianName: event.target.value })} placeholder="Nombre completo"/></label>
      <label><span>Teléfono del tutor</span><input type="tel" value={draft.guardianPhone} onChange={(event) => setDraft({ ...draft, guardianPhone: event.target.value })} placeholder="Número de contacto"/></label>
      <label className="field-wide"><span>Contacto de emergencia</span><input value={draft.emergencyContact} onChange={(event) => setDraft({ ...draft, emergencyContact: event.target.value })} placeholder="Nombre, parentesco y teléfono"/></label>
      {(["coordinador", "supervisor", "subdirector"] as const).map((role) => <label key={role}><span>{roleLabel(role)} responsable</span><select value={draft.responsibleAccountIds[role] || ""} onChange={(event) => setDraft({ ...draft, responsibleAccountIds: { ...draft.responsibleAccountIds, [role]: event.target.value || null } })}><option value="">Sin vincular</option>{roleOptions(role).map((item) => <option value={item.id} key={item.id}>{item.displayName}</option>)}</select></label>)}
      <div className="field-wide custom-fields-editor"><div><span>Casillas personalizadas</span><button type="button" onClick={() => setDraft({ ...draft, customFields: [...draft.customFields, { id: crypto.randomUUID(), label: "", value: "" }] })}><Plus size={14}/> Agregar casilla</button></div>{draft.customFields.length ? draft.customFields.map((field, index) => <div className="custom-field-row" key={field.id}><input aria-label={`Nombre de casilla ${index + 1}`} value={field.label} onChange={(event) => setDraft({ ...draft, customFields: draft.customFields.map((item) => item.id === field.id ? { ...item, label: event.target.value } : item) })} placeholder="Nombre de la casilla"/><input aria-label={`Valor de casilla ${index + 1}`} value={field.value} onChange={(event) => setDraft({ ...draft, customFields: draft.customFields.map((item) => item.id === field.id ? { ...item, value: event.target.value } : item) })} placeholder="Valor"/><button aria-label="Eliminar casilla" type="button" onClick={() => setDraft({ ...draft, customFields: draft.customFields.filter((item) => item.id !== field.id) })}><Trash2 size={15}/></button></div>) : <p>Agrega datos adicionales propios del centro sin cambiar la estructura del expediente.</p>}</div>
      <label className="field-wide"><span>Nota administrativa (opcional)</span><textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Información breve que ayude a identificar el caso."/></label>
    </div><div className="modal-actions"><button className="secondary-formation-button" onClick={() => setDraft(null)}>Cancelar</button><button className="primary-formation-button" disabled={saving} onClick={saveChild}>{saving ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>} Guardar niño</button></div></section></ModalLayer>}

    {deleteTarget && <ModalLayer onDismiss={() => setDeleteTarget(null)} className="modal-backdrop"><section className="confirm-modal" role="alertdialog" aria-modal="true"><span className="danger-mark"><Trash2 size={22}/></span><h2>Eliminar niño permanentemente</h2><p>Se eliminarán <strong>{deleteTarget.fullName}</strong>, sus {deleteTarget.evaluationCount || 0} evaluaciones, {deleteTarget.programCount || 0} programas y {deleteTarget.sessionCount || 0} sesiones. Esta acción no se puede deshacer.</p><label><span>Escribe ELIMINAR para confirmar</span><input autoFocus value={deleteText} onChange={(event) => setDeleteText(event.target.value)}/></label><div><button className="secondary-formation-button" onClick={() => setDeleteTarget(null)}>Cancelar</button><button className="danger-button" disabled={saving || deleteText.trim().toUpperCase() !== "ELIMINAR"} onClick={deleteChild}><Trash2 size={16}/> Eliminar permanentemente</button></div></section></ModalLayer>}
  </>;
}
