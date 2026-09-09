"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Edit3, LoaderCircle, MapPin, Play, Plus, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { roleLabel, type AppRole } from "../../lib/access-control";
import type { PersonnelProfile } from "./personnel-profile-manager";

export type CalendarAppointment = {
  id: string;
  profileId: string;
  profileName: string;
  professionalAccountId: string;
  professionalName: string;
  professionalRole: AppRole | null;
  canStart: boolean;
  site: string;
  sessionDate: string;
  startTime: string;
  endTime: string;
  sessionType: string;
  notes: string;
  status: "scheduled" | "in_progress" | "completed" | "cancelled";
  interventionSessionId: string | null;
};

type ClinicalProfessional = { id: string; displayName: string; email: string; role: AppRole; eligibleProfileIds: string[] };
type ViewMode = "week" | "month";
type AppointmentDraft = Pick<CalendarAppointment, "profileId" | "professionalAccountId" | "sessionDate" | "startTime" | "endTime" | "sessionType" | "notes"> & { id?: string };

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function iso(date: Date) {
  const year = date.getFullYear();
  return `${year}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function localDate(value: string) {
  return new Date(`${value}T12:00:00`);
}

function shift(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function monday(date: Date) {
  const day = date.getDay() || 7;
  return shift(date, 1 - day);
}

function viewDays(reference: Date, view: ViewMode) {
  if (view === "week") return Array.from({ length: 7 }, (_, index) => shift(monday(reference), index));
  const first = new Date(reference.getFullYear(), reference.getMonth(), 1);
  const start = monday(first);
  return Array.from({ length: 42 }, (_, index) => shift(start, index));
}

function blankDraft(profile?: PersonnelProfile, date = iso(new Date())): AppointmentDraft {
  return { profileId: profile?.id || "", professionalAccountId: "", sessionDate: date, startTime: "08:00", endTime: "09:00", sessionType: "Terapia individual", notes: "" };
}

function statusLabel(status: CalendarAppointment["status"]) {
  return { scheduled: "Programada", in_progress: "En curso", completed: "Completada", cancelled: "Cancelada" }[status];
}

export default function CalendarManager({
  profiles,
  compact = false,
  onOpenSession,
  notify,
}: {
  profiles: PersonnelProfile[];
  compact?: boolean;
  onOpenSession: (appointment: CalendarAppointment) => void;
  notify: (message: string) => void;
}) {
  const [reference, setReference] = useState(new Date());
  const [view, setView] = useState<ViewMode>(compact ? "week" : "month");
  const [appointments, setAppointments] = useState<CalendarAppointment[]>([]);
  const [professionals, setProfessionals] = useState<ClinicalProfessional[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<AppointmentDraft | null>(null);
  const days = useMemo(() => viewDays(reference, view), [reference, view]);
  const from = iso(days[0]);
  const to = iso(days[days.length - 1]);
  const requestTo = compact ? iso(shift(days[0], 30)) : to;

  async function load() {
    setLoading(true);
    try {
      const response = await fetch(`/api/calendar?from=${from}&to=${to}${compact ? "&mine=1" : ""}`, { cache: "no-store" });
      const data = await response.json() as { appointments?: CalendarAppointment[]; professionals?: ClinicalProfessional[]; canManage?: boolean; error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo cargar el calendario.");
      setAppointments(data.appointments || []);
      setProfessionals(data.professionals || []);
      setCanManage(Boolean(data.canManage));
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo cargar el calendario.");
    } finally { setLoading(false); }
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/calendar?from=${from}&to=${requestTo}${compact ? "&mine=1" : ""}`, { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() as { appointments?: CalendarAppointment[]; professionals?: ClinicalProfessional[]; canManage?: boolean; error?: string } }))
      .then(({ response, data }) => {
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || "No se pudo cargar el calendario.");
        setAppointments(data.appointments || []);
        setProfessionals(data.professionals || []);
        setCanManage(Boolean(data.canManage));
      })
      .catch((error: Error) => { if (!cancelled) notify(error.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  // The date range is the source of truth; toast identity does not change it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, requestTo]);

  const activeProfiles = profiles.filter((profile) => profile.status === "active");
  const eligibleProfessionals = draft ? professionals.filter((professional) => professional.eligibleProfileIds.includes(draft.profileId)) : professionals;
  const today = iso(new Date());
  const upcoming = appointments.filter((appointment) => appointment.status !== "cancelled" && appointment.sessionDate >= today).slice(0, compact ? 5 : 8);

  function openNew(date = today) {
    setDraft(blankDraft(activeProfiles[0], date));
  }

  function edit(appointment: CalendarAppointment) {
    setDraft({
      id: appointment.id,
      profileId: appointment.profileId,
      professionalAccountId: appointment.professionalAccountId,
      sessionDate: appointment.sessionDate,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      sessionType: appointment.sessionType,
      notes: appointment.notes,
    });
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const response = await fetch("/api/calendar", { method: draft.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const data = await response.json() as { appointment?: CalendarAppointment; error?: string };
      if (!response.ok || !data.appointment) throw new Error(data.error || "No se pudo guardar la sesión programada.");
      setDraft(null);
      notify(draft.id ? "Sesión programada actualizada." : "Sesión añadida al calendario del profesional.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo guardar la sesión programada.");
    } finally { setSaving(false); }
  }

  async function cancel(appointment: CalendarAppointment) {
    setSaving(true);
    try {
      const response = await fetch("/api/calendar", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: appointment.id, action: appointment.status === "cancelled" ? "restore" : "cancel" }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo cambiar el estado de la sesión.");
      notify(appointment.status === "cancelled" ? "Sesión restaurada." : "Sesión cancelada; el historial permanece disponible.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo actualizar la sesión.");
    } finally { setSaving(false); }
  }

  const title = reference.toLocaleDateString("es-NI", { month: "long", year: "numeric" });
  const step = view === "week" ? 7 : 30;

  return <div className={`calendar-module ${compact ? "compact" : ""}`}>
    {!compact && <div className="formation-heading calendar-heading"><div><p className="section-kicker">Agenda clínica</p><h1>Calendario de sesiones</h1><p>Programa la atención y dirige al profesional responsable al registro clínico existente.</p></div>{canManage && <button className="primary-formation-button" onClick={() => openNew()}><Plus size={16}/> Programar sesión</button>}</div>}
    <section className="formation-panel calendar-board">
      <header className="calendar-toolbar"><div><button aria-label="Periodo anterior" onClick={() => setReference(shift(reference, -step))}><ChevronLeft size={17}/></button><button onClick={() => setReference(new Date())}>Hoy</button><button aria-label="Periodo siguiente" onClick={() => setReference(shift(reference, step))}><ChevronRight size={17}/></button></div><h2>{title}</h2>{!compact && <div className="calendar-view-toggle"><button className={view === "week" ? "active" : ""} onClick={() => setView("week")}>Semanal</button><button className={view === "month" ? "active" : ""} onClick={() => setView("month")}>Mensual</button></div>}</header>
      {loading ? <div className="calendar-loading"><LoaderCircle className="spin" size={25}/><strong>Cargando agenda…</strong></div> : <div className={`calendar-grid ${view}`}>
        {WEEKDAYS.map((weekday) => <span className="calendar-weekday" key={weekday}>{weekday}</span>)}
        {days.map((day) => {
          const dayIso = iso(day);
          const dayAppointments = appointments.filter((appointment) => appointment.sessionDate === dayIso);
          return <article className={`${dayIso === today ? "today" : ""} ${day.getMonth() !== reference.getMonth() && view === "month" ? "outside" : ""}`} key={dayIso} onDoubleClick={() => canManage && openNew(dayIso)}>
            <header><span>{day.getDate()}</span>{dayIso === today && <small>Hoy</small>}</header>
            <div>{dayAppointments.map((appointment) => <button className={`calendar-event ${appointment.status}`} key={appointment.id} title={`${appointment.profileName} · ${appointment.professionalName}`} onClick={() => appointment.canStart && (appointment.status === "scheduled" || appointment.status === "in_progress") ? onOpenSession(appointment) : undefined}><strong>{appointment.startTime} · {appointment.profileName}</strong><small>{appointment.professionalName}</small></button>)}</div>
            {canManage && !compact && <button className="calendar-day-add" aria-label={`Programar el ${dayIso}`} onClick={() => openNew(dayIso)}><Plus size={13}/></button>}
          </article>;
        })}
      </div>}
    </section>
    <section className="formation-panel upcoming-sessions-panel"><header><div><p className="section-kicker">Trabajo inmediato</p><h2>Próximas terapias</h2></div><span>{upcoming.length}</span></header>{upcoming.length ? <div>{upcoming.map((appointment) => <article key={appointment.id}><time><strong>{localDate(appointment.sessionDate).toLocaleDateString("es-NI", { weekday: "short", day: "2-digit", month: "short" })}</strong><span>{appointment.startTime}–{appointment.endTime}</span></time><div><strong>{appointment.profileName}</strong><small><UserRound size={13}/>{appointment.professionalName}{appointment.professionalRole ? ` · ${roleLabel(appointment.professionalRole)}` : ""} · <MapPin size={13}/>{appointment.site}</small></div><span className={`appointment-status ${appointment.status}`}>{statusLabel(appointment.status)}</span><div className="appointment-actions"><button className="session-enter" disabled={!appointment.canStart || appointment.status === "completed"} onClick={() => onOpenSession(appointment)}><Play size={14}/>{appointment.status === "completed" ? "Completada" : appointment.canStart ? "Iniciar terapia" : "Asignada a otro profesional"}</button>{canManage && !appointment.interventionSessionId && <><button title="Editar" aria-label="Editar sesión programada" onClick={() => edit(appointment)}><Edit3 size={14}/></button><button className="cancel" onClick={() => cancel(appointment)}>{appointment.status === "cancelled" ? "Restaurar" : "Cancelar"}</button></>}</div></article>)}</div> : <div className="calendar-empty"><CalendarDays size={25}/><strong>No hay terapias próximas en este alcance.</strong><p>{canManage ? "Programa una sesión cuando existan niños y profesionales clínicos disponibles." : "Las nuevas asignaciones aparecerán aquí automáticamente."}</p></div>}</section>

    {draft && <div className="modal-backdrop"><section className="calendar-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-modal-title"><div className="modal-title"><div><p className="section-kicker">Agenda clínica</p><h2 id="calendar-modal-title">{draft.id ? "Editar sesión programada" : "Programar sesión"}</h2></div><button aria-label="Cerrar" onClick={() => setDraft(null)}><X size={19}/></button></div><div className="calendar-form-grid">
      <label><span>Niño</span><select autoFocus value={draft.profileId} onChange={(event) => setDraft({ ...draft, profileId: event.target.value, professionalAccountId: "" })}><option value="">Seleccionar niño</option>{activeProfiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.fullName} · {profile.site}</option>)}</select></label>
      <label><span>Profesional clínico</span><select value={draft.professionalAccountId} onChange={(event) => setDraft({ ...draft, professionalAccountId: event.target.value })}><option value="">Seleccionar profesional responsable</option>{eligibleProfessionals.map((professional) => <option value={professional.id} key={professional.id}>{professional.displayName} · {roleLabel(professional.role)}</option>)}</select>{draft.profileId && !eligibleProfessionals.length && <small>No hay profesionales con permiso y alcance clínico para este niño.</small>}</label>
      <label><span>Fecha</span><input type="date" value={draft.sessionDate} onChange={(event) => setDraft({ ...draft, sessionDate: event.target.value })}/></label>
      <label><span>Tipo de sesión</span><input value={draft.sessionType} onChange={(event) => setDraft({ ...draft, sessionType: event.target.value })} placeholder="Terapia individual"/></label>
      <label><span>Hora de inicio</span><input type="time" value={draft.startTime} onChange={(event) => setDraft({ ...draft, startTime: event.target.value })}/></label>
      <label><span>Hora de finalización</span><input type="time" value={draft.endTime} onChange={(event) => setDraft({ ...draft, endTime: event.target.value })}/></label>
      <label className="field-wide"><span>Notas u observaciones (opcional)</span><textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Información necesaria para preparar la atención"/></label>
    </div><div className="calendar-form-note"><Clock3 size={16}/><p>La cita organiza el trabajo. Los resultados clínicos se guardan cuando el profesional asignado cierra la sesión.</p></div><div className="modal-actions"><button className="secondary-formation-button" onClick={() => setDraft(null)}>Cancelar</button><button className="primary-formation-button" disabled={saving || !draft.profileId || !draft.professionalAccountId} onClick={save}>{saving ? <LoaderCircle className="spin" size={16}/> : <CalendarDays size={16}/>} Guardar en calendario</button></div></section></div>}
  </div>;
}
