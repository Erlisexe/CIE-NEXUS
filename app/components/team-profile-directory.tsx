"use client";

import {
  ArrowLeft,
  AtSign,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FolderOpen,
  Mail,
  MapPin,
  Search,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { roleLabel, type AppRole } from "../../lib/access-control";
import ProfilePhoto, { uploadProfilePhoto } from "./profile-photo";

type ChildSummary = {
  id: string;
  fullName: string;
  site: string;
  internalCode: string;
  status: "active" | "archived";
  evaluationCount: number;
  programCount: number;
  sessionCount: number;
  photoUrl: string | null;
};

type ProfessionalProfile = {
  id: string;
  displayName: string;
  username: string;
  email: string;
  role: AppRole;
  status: "invited" | "active" | "suspended";
  activationState: "activated" | "pending";
  siteScope: string[];
  assignedChildCount: number;
  children: ChildSummary[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  photoUrl: string | null;
  canManagePhoto: boolean;
};

type Section = "overview" | "general" | "children" | "scope";

const ROLE_ORDER: AppRole[] = ["subdirector", "supervisor", "coordinador", "terapeuta"];

function formatDate(value: string | null) {
  if (!value) return "No registrado";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("es-NI", { dateStyle: "medium", timeStyle: "short" });
}

function statusLabel(profile: ProfessionalProfile) {
  if (profile.status === "suspended") return "Suspendida";
  if (profile.activationState === "pending") return "Pendiente";
  return "Activa";
}

function roleDescription(role: AppRole) {
  return ({
    direccion_clinica: "Dirección y control institucional",
    subdirector: "Supervisión clínica institucional",
    supervisor: "Seguimiento de sedes, coordinadores y terapeutas",
    coordinador: "Coordinación de programas y atención clínica",
    terapeuta: "Ejecución directa de servicios terapéuticos",
  } as Record<AppRole, string>)[role];
}

function hierarchyDescription(role: AppRole) {
  return ({
    direccion_clinica: "Puede consultar Subdirección, Supervisión, Coordinación y Terapia.",
    subdirector: "Puede consultar Supervisión, Coordinación y Terapia.",
    supervisor: "Puede consultar Coordinación y Terapia.",
    coordinador: "Puede consultar Terapia.",
    terapeuta: "No visualiza otros perfiles profesionales.",
  } as Record<AppRole, string>)[role];
}

export default function TeamProfileDirectory({ viewerRole, canOpenChildren, onOpenChild, notify }: { viewerRole: AppRole; canOpenChildren: boolean; onOpenChild: (profileId: string) => void; notify: (message: string) => void }) {
  const [profiles, setProfiles] = useState<ProfessionalProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | AppRole>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [photoUploadingId, setPhotoUploadingId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/team-profiles", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { profiles?: ProfessionalProfile[]; error?: string };
        if (!response.ok) throw new Error(data.error || "No se pudo cargar el equipo clínico.");
        return data.profiles || [];
      })
      .then(setProfiles)
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) notify(error instanceof Error ? error.message : "No se pudo cargar el equipo clínico.");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [notify]);

  const selected = profiles.find((profile) => profile.id === selectedId) || null;
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("es");
    return profiles.filter((profile) => {
      const matchesRole = roleFilter === "all" || profile.role === roleFilter;
      const matchesText = !needle || [profile.displayName, profile.username, profile.email, roleLabel(profile.role), profile.siteScope.join(" ")].some((value) => value.toLocaleLowerCase("es").includes(needle));
      return matchesRole && matchesText;
    });
  }, [profiles, query, roleFilter]);

  function openProfile(id: string) {
    setSelectedId(id);
    setSection("overview");
  }

  async function changePhoto(profileId: string, file: File) {
    setPhotoUploadingId(profileId);
    try {
      const photoUrl = await uploadProfilePhoto("account", profileId, file);
      setProfiles((current) => current.map((profile) => profile.id === profileId ? { ...profile, photoUrl } : profile));
      notify("Fotografía del perfil actualizada.");
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo guardar la fotografía.");
    } finally { setPhotoUploadingId(null); }
  }

  if (selected) return <ProfessionalWorkspace profile={selected} viewerRole={viewerRole} canOpenChildren={canOpenChildren} section={section} onSection={setSection} onBack={() => setSelectedId(null)} onOpenChild={onOpenChild} photoUploading={photoUploadingId === selected.id} onPhoto={(file) => changePhoto(selected.id, file)}/>;

  return <>
    <div className="formation-heading team-heading"><div><p className="section-kicker">Directorio profesional</p><h1>Equipo clínico</h1><p>Consulta perfiles profesionales según tu nivel jerárquico y abre los expedientes infantiles vinculados.</p></div><span className="team-hierarchy-badge"><ShieldCheck size={17}/>{roleLabel(viewerRole)}</span></div>
    <section className="team-access-note"><ShieldCheck size={20}/><div><strong>Visibilidad jerárquica protegida</strong><p>{hierarchyDescription(viewerRole)} Cada expediente infantil conserva además sus propias reglas de acceso.</p></div></section>

    <section className="team-summary">{ROLE_ORDER.filter((role) => profiles.some((profile) => profile.role === role)).map((role) => <button className={roleFilter === role ? "active" : ""} key={role} onClick={() => setRoleFilter(roleFilter === role ? "all" : role)}><span className={`team-role-mark role-${role}`}><UserRound size={18}/></span><div><small>{roleLabel(role)}</small><strong>{profiles.filter((profile) => profile.role === role).length}</strong></div></button>)}<article><span><UsersRound size={19}/></span><div><small>Total visible</small><strong>{profiles.length}</strong></div></article></section>

    <section className="team-toolbar"><label><Search size={17}/><span className="sr-only">Buscar profesional</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nombre, rol, sede o usuario"/></label><select aria-label="Filtrar por rol" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as "all" | AppRole)}><option value="all">Todos los roles visibles</option>{ROLE_ORDER.filter((role) => profiles.some((profile) => profile.role === role)).map((role) => <option key={role} value={role}>{roleLabel(role)}</option>)}</select><span>{visible.length} perfil{visible.length === 1 ? "" : "es"}</span></section>

    {loading ? <div className="team-loading"><span className="spin"><Clock3 size={25}/></span><strong>Cargando equipo…</strong></div> : visible.length ? <div className="team-role-groups">{ROLE_ORDER.map((role) => {
      const roleProfiles = visible.filter((profile) => profile.role === role);
      if (!roleProfiles.length) return null;
      return <section className="team-role-group" key={role}><header><div><span className={`team-role-mark role-${role}`}><UserRound size={18}/></span><div><small>Nivel profesional</small><h2>{roleLabel(role)}</h2></div></div><span>{roleProfiles.length} persona{roleProfiles.length === 1 ? "" : "s"}</span></header><div className="team-profile-grid">{roleProfiles.map((profile) => <article className="team-profile-card" key={profile.id}><div className="team-card-identity"><ProfilePhoto name={profile.displayName} src={profile.photoUrl} avatarClassName={`team-avatar role-${profile.role}`}/><div><h3>{profile.displayName}</h3><p>@{profile.username}</p></div><span className={`team-account-status ${profile.status}`}>{statusLabel(profile)}</span></div><p className="team-role-copy">{roleDescription(profile.role)}</p><div className="team-card-stats"><div><strong>{profile.children.length}</strong><small>Niños visibles</small></div><div><strong>{profile.siteScope.length || new Set(profile.children.map((child) => child.site)).size}</strong><small>Sedes</small></div></div><button className="team-open-profile" onClick={() => openProfile(profile.id)}><span><FolderOpen size={15}/></span><strong>Abrir perfil</strong><ChevronRight size={16}/></button></article>)}</div></section>;
    })}</div> : <div className="team-empty"><UsersRound size={31}/><strong>No hay perfiles en esta vista</strong><p>Prueba otro filtro o confirma que existan cuentas en los niveles profesionales que puedes consultar.</p></div>}
  </>;
}

function ProfessionalWorkspace({ profile, viewerRole, canOpenChildren, section, onSection, onBack, onOpenChild, photoUploading, onPhoto }: { profile: ProfessionalProfile; viewerRole: AppRole; canOpenChildren: boolean; section: Section; onSection: (section: Section) => void; onBack: () => void; onOpenChild: (profileId: string) => void; photoUploading: boolean; onPhoto: (file: File) => void }) {
  const childSites = [...new Set(profile.children.map((child) => child.site))];
  const scopeSites = profile.siteScope.length ? profile.siteScope : childSites;
  const sections: Array<{ key: Section; label: string }> = [{ key: "overview", label: "Resumen" }, { key: "general", label: "Datos generales" }, { key: "children", label: "Niños" }, { key: "scope", label: "Alcance" }];

  function renderContent() {
    if (section === "overview") return <div className="professional-module-grid">
      <button onClick={() => onSection("general")}><span><UserRound size={23}/></span><div><strong>Datos generales</strong><small>Identidad, rol y estado de la cuenta</small></div><em>Abrir</em></button>
      <button className="children-module" disabled={!canOpenChildren} onClick={() => onSection("children")}><span><UsersRound size={23}/></span><div><strong>Niños</strong><small>{canOpenChildren ? "Acceso directo a sus expedientes infantiles" : "Tu rol no tiene acceso a expedientes infantiles"}</small></div><em>{profile.children.length}</em></button>
      <button className="scope-module" onClick={() => onSection("scope")}><span><Building2 size={23}/></span><div><strong>Alcance</strong><small>Sedes y vinculación clínica visible</small></div><em>{scopeSites.length}</em></button>
    </div>;

    if (section === "general") return <section className="professional-section-card"><header><div><p className="section-kicker">Información profesional</p><h2>Datos generales</h2></div><span className={`team-account-status ${profile.status}`}>{statusLabel(profile)}</span></header><div className="professional-detail-grid"><Detail icon={UserRound} label="Nombre completo" value={profile.displayName}/><Detail icon={ShieldCheck} label="Rol" value={roleLabel(profile.role)}/><Detail icon={AtSign} label="Usuario" value={`@${profile.username}`}/><Detail icon={Mail} label="Correo de acceso" value={profile.email}/><Detail icon={Clock3} label="Último acceso" value={formatDate(profile.lastLoginAt)}/><Detail icon={CalendarDays} label="Cuenta creada" value={formatDate(profile.createdAt)}/></div></section>;

    if (section === "children") return <section className="professional-section-card"><header><div><p className="section-kicker">Casos vinculados</p><h2>Niños</h2><p>Cada botón abre el expediente infantil completo, siempre dentro de tu alcance autorizado.</p></div><span>{profile.children.length} visible{profile.children.length === 1 ? "" : "s"}</span></header>{profile.children.length ? <div className="professional-child-grid">{profile.children.map((child) => <article key={child.id}><div className="professional-child-head"><ProfilePhoto name={child.fullName} src={child.photoUrl} avatarClassName="professional-child-avatar"/><div><h3>{child.fullName}</h3><p><MapPin size={12}/> {child.site}{child.internalCode ? ` · ${child.internalCode}` : ""}</p></div></div><div className="professional-child-stats"><span><strong>{child.evaluationCount}</strong> Evaluaciones</span><span><strong>{child.programCount}</strong> Programas</span><span><strong>{child.sessionCount}</strong> Sesiones</span></div><button onClick={() => onOpenChild(child.id)}><FolderOpen size={15}/> Abrir expediente <ChevronRight size={15}/></button></article>)}</div> : <div className="team-empty compact"><UsersRound size={28}/><strong>No hay niños visibles vinculados</strong><p>Puede no tener casos asignados o algunos expedientes pueden estar fuera de tu alcance actual.</p></div>}</section>;

    return <div className="professional-scope-layout"><section className="professional-section-card"><header><div><p className="section-kicker">Cobertura clínica</p><h2>Sedes vinculadas</h2></div></header><div className="professional-site-list">{scopeSites.length ? scopeSites.map((site) => <div key={site}><span><Building2 size={18}/></span><div><strong>{site}</strong><small>{profile.children.filter((child) => child.site === site).length} niño{profile.children.filter((child) => child.site === site).length === 1 ? "" : "s"} visible{profile.children.filter((child) => child.site === site).length === 1 ? "" : "s"}</small></div></div>) : <p>Sin sedes visibles vinculadas.</p>}</div></section><section className="professional-section-card"><header><div><p className="section-kicker">Regla de acceso</p><h2>Jerarquía profesional</h2></div></header><div className="professional-hierarchy-note"><ShieldCheck size={23}/><strong>{roleLabel(viewerRole)}</strong><p>{hierarchyDescription(viewerRole)}</p><small>Ver un perfil profesional no amplía el acceso a expedientes infantiles fuera del alcance de la cuenta.</small></div><div className="professional-scope-count"><div><strong>{profile.assignedChildCount}</strong><small>Niños vinculados al profesional</small></div><div><strong>{profile.children.length}</strong><small>Niños visibles para ti</small></div></div></section></div>;
  }

  return <div className="professional-workspace"><button className="back-button" onClick={onBack}><ArrowLeft size={17}/> Volver al equipo</button><section className={`professional-identity-card role-${profile.role}`}><ProfilePhoto name={profile.displayName} src={profile.photoUrl} avatarClassName={`professional-avatar role-${profile.role}`} editable={profile.canManagePhoto} uploading={photoUploading} onFile={onPhoto}/><div><p className="section-kicker">Perfil profesional</p><h1>{profile.displayName}</h1><p>{roleLabel(profile.role)} · @{profile.username}</p><div><span className={`team-account-status ${profile.status}`}><CheckCircle2 size={12}/>{statusLabel(profile)}</span>{scopeSites.length > 0 && <span><Building2 size={13}/>{scopeSites.length} sede{scopeSites.length === 1 ? "" : "s"}</span>}<span><UsersRound size={13}/>{profile.children.length} niño{profile.children.length === 1 ? "" : "s"} visible{profile.children.length === 1 ? "" : "s"}</span></div></div><small>Perfil clínico organizado</small></section><nav className="professional-section-nav" aria-label="Apartados del perfil profesional">{sections.map((item) => <button className={section === item.key ? "active" : ""} key={item.key} disabled={item.key === "children" && !canOpenChildren} onClick={() => onSection(item.key)}>{item.label}{item.key === "children" && <em>{profile.children.length}</em>}</button>)}</nav><div className="professional-section-title"><div><p className="section-kicker">{profile.displayName}</p><h2>{sections.find((item) => item.key === section)?.label}</h2></div>{section !== "overview" && <button onClick={() => onSection("overview")}>Ver todos los apartados</button>}</div>{renderContent()}</div>;
}

function Detail({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) {
  return <div className="professional-detail"><span><Icon size={17}/></span><div><small>{label}</small><strong>{value}</strong></div></div>;
}
