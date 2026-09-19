"use client";

import { clientRequest } from "../../lib/client-request";
import { collectionDateTime } from "../../lib/mobile-collection";
import { StartTodaySessionButton } from "./today-session-launcher";

import ModalLayer from "./modal-layer";

import { AlertTriangle, Ban, CalendarDays, ChevronLeft, ChevronRight, Clock3, Edit3, LoaderCircle, MapPin, Play, Plus, RotateCcw, Trash2, UserRound, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AppRole } from "../../lib/access-control";
import { CANCELLATION_CATEGORIES, cancellationLabel, type CancellationCategory } from "../../lib/calendar-appointments";
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
  clinicalSessionRunId: string | null;
  hasClinicalEvidence: boolean;
  cancellationCategory: CancellationCategory | null;
  cancellationReason: string;
  cancelledByAccountId: string | null;
  cancelledAt: string | null;
};

type ClinicalProfessional = { id: string; displayName: string; email: string; role: AppRole; eligibleProfileIds: string[] };
type ViewMode = "week" | "month";
type AppointmentDraft = Pick<CalendarAppointment, "profileId" | "professionalAccountId" | "sessionDate" | "startTime" | "endTime" | "sessionType" | "notes"> & { id?: string };

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function roleLabel(role: AppRole) {
  return {
    direccion_clinica: "Dirección Clínica",
    subdirector: "Subdirector clínico",
    supervisor: "Supervisor clínico",
    coordinador: "Coordinador clínico",
    terapeuta: "Terapeuta clínico",
  }[role];
}

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
  const [loadError, setLoadError] = useState("");
  const [reloadRevision, setReloadRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<AppointmentDraft | null>(null);
  const [selectedAppointment, setSelectedAppointment] = useState<CalendarAppointment | null>(null);
  const [cancelTarget, setCancelTarget] = useState<CalendarAppointment | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CalendarAppointment | null>(null);
  const [cancellationCategory, setCancellationCategory] = useState<CancellationCategory | "">("");
  const [cancellationReason, setCancellationReason] = useState("");
  const days = useMemo(() => viewDays(reference, view), [reference, view]);
  const from = iso(days[0]);
  const to = iso(days[days.length - 1]);
  const requestTo = compact ? iso(shift(days[0], 30)) : to;

  function load() { setReloadRevision(current => current + 1); }

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    // Date changes must never expose stale appointments as the new period.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true); setLoadError("");
    clientRequest(`/api/calendar?from=${from}&to=${requestTo}${compact ? "&mine=1" : ""}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ response, data: await response.json() as { appointments?: CalendarAppointment[]; professionals?: ClinicalProfessional[]; canManage?: boolean; error?: string } }))
      .then(({ response, data }) => {
        if (cancelled) return;
        if (!response.ok) throw new Error(data.error || "No se pudo cargar el calendario.");
        setAppointments(data.appointments || []);
        setProfessionals(data.professionals || []);
        setCanManage(Boolean(data.canManage));
      })
      .catch((error: Error) => { if (!cancelled) { setLoadError(error.message); notify(error.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; controller.abort(); };
  // The date range is the source of truth; toast identity does not change it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, requestTo, compact, reloadRevision]);

  const activeProfiles = profiles.filter((profile) => profile.status === "active");
  const eligibleProfessionals = draft ? professionals.filter((professional) => professional.eligibleProfileIds.includes(draft.profileId)) : professionals;
  const today = collectionDateTime(new Date()).date;
  const upcoming = loading || loadError ? [] : appointments.filter((appointment) => appointment.status !== "cancelled" && appointment.sessionDate >= today).slice(0, compact ? 5 : 8);

  function openNew(date = today) {
    setSelectedAppointment(null);
    setDraft(blankDraft(activeProfiles[0], date));
  }

  function openManagement(appointment: CalendarAppointment) {
    setSelectedAppointment(appointment);
  }

  function edit(appointment: CalendarAppointment) {
    setSelectedAppointment(null);
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
      const response = await clientRequest("/api/calendar", { method: draft.id ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const data = await response.json() as { appointment?: CalendarAppointment; error?: string };
      if (!response.ok || !data.appointment) throw new Error(data.error || "No se pudo guardar la sesión programada.");
      setDraft(null);
      notify(draft.id ? "Sesión programada actualizada." : "Sesión añadida al calendario del profesional.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo guardar la sesión programada.");
    } finally { setSaving(false); }
  }

  function openCancellation(appointment: CalendarAppointment) {
    setSelectedAppointment(null);
    setCancelTarget(appointment);
    setCancellationCategory("");
    setCancellationReason("");
  }

  async function cancel() {
    if (!cancelTarget || !cancellationCategory || (cancellationCategory === "other" && !cancellationReason.trim())) return;
    setSaving(true);
    try {
      const response = await clientRequest("/api/calendar", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: cancelTarget.id, action: "cancel", cancellationCategory, cancellationReason }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo cancelar la sesión.");
      setCancelTarget(null);
      notify("Sesión cancelada; la categoría y el horario permanecen en el historial.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo cancelar la sesión.");
    } finally { setSaving(false); }
  }

  async function restore(appointment: CalendarAppointment) {
    setSaving(true);
    try {
      const response = await clientRequest("/api/calendar", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: appointment.id, action: "restore" }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo restaurar la sesión.");
      setSelectedAppointment(null);
      notify("Sesión restaurada en el calendario.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo restaurar la sesión.");
    } finally { setSaving(false); }
  }

  function openDeletion(appointment: CalendarAppointment) {
    setSelectedAppointment(null);
    setDeleteTarget(appointment);
  }

  async function remove() {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      const response = await clientRequest("/api/calendar", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: deleteTarget.id }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo eliminar la sesión programada.");
      setDeleteTarget(null);
      notify("La sesión programada se quitó del calendario.");
      await load();
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo eliminar la sesión programada.");
    } finally { setSaving(false); }
  }

  const title = reference.toLocaleDateString("es-NI", { month: "long", year: "numeric" });
  function movePeriod(direction: number) { setReference(current => view === "week" ? shift(current, direction * 7) : new Date(current.getFullYear(), current.getMonth() + direction, 1, 12)); }

  return <div className={`calendar-module ${compact ? "compact" : ""}`}>
    {!compact && <div className="formation-heading calendar-heading"><div><p className="section-kicker">Agenda clínica</p><h1>Calendario de sesiones</h1><p>Selecciona cualquier cita —incluso de fechas pasadas— para gestionarla sin salir del calendario. Las acciones administrativas sólo aparecen cuando no existe evidencia clínica.</p></div>{canManage && <button className="primary-formation-button" onClick={() => openNew()}><Plus size={16}/> Programar sesión</button>}</div>}
    <section className="formation-panel calendar-board">
      <header className="calendar-toolbar"><div><button aria-label="Periodo anterior" onClick={() => movePeriod(-1)}><ChevronLeft size={17}/></button><button onClick={() => setReference(new Date())}>Hoy</button><button aria-label="Periodo siguiente" onClick={() => movePeriod(1)}><ChevronRight size={17}/></button></div><h2>{title}</h2>{!compact && <div className="calendar-view-toggle"><button className={view === "week" ? "active" : ""} onClick={() => setView("week")}>Semanal</button><button className={view === "month" ? "active" : ""} onClick={() => setView("month")}>Mensual</button></div>}</header>
      {loadError ? <div className="load-error" role="alert"><p>{loadError}</p><button onClick={load}>Reintentar carga</button></div> : loading ? <div className="calendar-loading" role="status"><LoaderCircle className="spin" size={25}/><strong>Cargando agenda…</strong></div> : <div className={`calendar-grid ${view}`}>
        {WEEKDAYS.map((weekday) => <span className="calendar-weekday" key={weekday}>{weekday}</span>)}
        {days.map((day) => {
          const dayIso = iso(day);
          const dayAppointments = appointments.filter((appointment) => appointment.sessionDate === dayIso);
          return <article className={`${dayIso === today ? "today" : ""} ${day.getMonth() !== reference.getMonth() && view === "month" ? "outside" : ""}`} key={dayIso} onDoubleClick={() => canManage && !compact && openNew(dayIso)}>
            <header><span>{day.getDate()}</span>{dayIso === today && <small>Hoy</small>}</header>
            <div>{dayAppointments.map((appointment) => <button className={`calendar-event ${appointment.status}`} disabled={!(canManage && !compact) && !(appointment.canStart && (appointment.status === "scheduled" || appointment.status === "in_progress"))} key={appointment.id} title={appointment.status === "cancelled" ? `${appointment.profileName} · ${cancellationLabel(appointment.cancellationCategory)}${appointment.cancellationReason ? ` · ${appointment.cancellationReason}` : ""}` : `${appointment.profileName} · ${appointment.professionalName} · ${statusLabel(appointment.status)}`} onClick={() => {
              if (canManage && !compact) return openManagement(appointment);
              if (appointment.canStart && (appointment.status === "scheduled" || appointment.status === "in_progress")) onOpenSession(appointment);
            }}><strong>{appointment.startTime} · {appointment.profileName}</strong><small>{appointment.status === "cancelled" ? `Cancelada · ${cancellationLabel(appointment.cancellationCategory)}` : appointment.professionalName}</small></button>)}</div>
            {canManage && !compact && <button className="calendar-day-add" aria-label={`Programar el ${dayIso}`} onClick={() => openNew(dayIso)}><Plus size={13}/></button>}
          </article>;
        })}
      </div>}
    </section>
    <section className="formation-panel upcoming-sessions-panel"><header><div><p className="section-kicker">Trabajo inmediato</p><h2>Próximas terapias</h2></div><span>{upcoming.length}</span></header>{upcoming.length ? <div>{upcoming.map((appointment) => <article key={appointment.id}><time><strong>{localDate(appointment.sessionDate).toLocaleDateString("es-NI", { weekday: "short", day: "2-digit", month: "short" })}</strong><span>{appointment.startTime}–{appointment.endTime}</span></time><div><strong>{appointment.profileName}</strong><small><UserRound size={13}/>{appointment.professionalName}{appointment.professionalRole ? ` · ${roleLabel(appointment.professionalRole)}` : ""} · <MapPin size={13}/>{appointment.site}</small></div><span className={`appointment-status ${appointment.status}`}>{statusLabel(appointment.status)}</span><div className="appointment-actions">{compact ? (appointment.canStart && appointment.sessionDate === today && (appointment.status === "scheduled" || appointment.status === "in_progress") ? <StartTodaySessionButton className="session-enter" continuing={appointment.status === "in_progress"} onClick={() => onOpenSession(appointment)}/> : <span className="session-entry-hint">{appointment.status === "completed" ? "Completada" : appointment.sessionDate !== today ? "Disponible el día de la cita" : "No disponible para tu cuenta"}</span>) : <button className="session-enter" disabled={!appointment.canStart || appointment.status === "completed"} onClick={() => onOpenSession(appointment)}><Play size={14}/>{appointment.status === "completed" ? "Completada" : appointment.canStart ? "Iniciar terapia" : "Asignada a otro profesional"}</button>}{canManage && !compact && <button className="manage-appointment" onClick={() => openManagement(appointment)}><Edit3 size={14}/>Gestionar</button>}</div></article>)}</div> : <div className="calendar-empty"><CalendarDays size={25}/><strong>No hay terapias próximas en este alcance.</strong><p>{canManage && !compact ? "Programa una sesión o navega a otra fecha para gestionar la agenda." : "Las nuevas asignaciones aparecerán aquí automáticamente."}</p></div>}</section>

    {selectedAppointment && !compact && <ModalLayer onDismiss={() => setSelectedAppointment(null)} className="modal-backdrop"><section className="calendar-modal appointment-management-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-manage-title"><div className="modal-title"><div><p className="section-kicker">Gestión directa</p><h2 id="calendar-manage-title">Gestionar sesión</h2></div><button aria-label="Cerrar" onClick={() => setSelectedAppointment(null)}><X size={19}/></button></div>
      <div className="calendar-form-grid appointment-readonly-grid">
        <label><span>Niño</span><input readOnly value={selectedAppointment.profileName}/></label>
        <label><span>Profesional</span><input readOnly value={selectedAppointment.professionalName}/></label>
        <label><span>Fecha</span><input readOnly value={localDate(selectedAppointment.sessionDate).toLocaleDateString("es-NI", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}/></label>
        <label><span>Horario</span><input readOnly value={`${selectedAppointment.startTime}–${selectedAppointment.endTime}`}/></label>
        <label><span>Tipo</span><input readOnly value={selectedAppointment.sessionType}/></label>
        <label><span>Estado</span><input readOnly value={statusLabel(selectedAppointment.status)}/></label>
        {selectedAppointment.notes && <label className="field-wide"><span>Notas</span><textarea readOnly value={selectedAppointment.notes}/></label>}
      </div>
      {selectedAppointment.status === "cancelled" && <div className="calendar-form-note cancellation-detail"><Ban size={16}/><p><strong>{cancellationLabel(selectedAppointment.cancellationCategory)}</strong>{selectedAppointment.cancellationReason ? ` · ${selectedAppointment.cancellationReason}` : ""}{selectedAppointment.cancelledAt ? ` · ${new Date(selectedAppointment.cancelledAt).toLocaleString("es-NI", { timeZone: "America/Managua" })}` : ""}</p></div>}
      {selectedAppointment.hasClinicalEvidence && <div className="calendar-form-note protected"><AlertTriangle size={16}/><p>Esta cita ya contiene evidencia clínica. Puede consultarse, pero no editarse, cancelarse ni eliminarse desde el calendario.</p></div>}
      <div className="modal-actions appointment-management-actions">
        <button className="secondary-formation-button" onClick={() => setSelectedAppointment(null)}>Cerrar</button>
        {!selectedAppointment.hasClinicalEvidence && (selectedAppointment.status === "scheduled" || selectedAppointment.status === "cancelled") && <button className="secondary-formation-button" disabled={saving} onClick={() => edit(selectedAppointment)}><Edit3 size={15}/> Editar</button>}
        {selectedAppointment.canStart && (selectedAppointment.status === "scheduled" || selectedAppointment.status === "in_progress") && <button className="primary-formation-button" disabled={saving} onClick={() => { setSelectedAppointment(null); onOpenSession(selectedAppointment); }}><Play size={15}/> Iniciar terapia</button>}
        {!selectedAppointment.hasClinicalEvidence && selectedAppointment.status === "scheduled" && <button className="secondary-formation-button cancel-management" disabled={saving} onClick={() => openCancellation(selectedAppointment)}><Ban size={15}/> Cancelar sesión</button>}
        {!selectedAppointment.hasClinicalEvidence && selectedAppointment.status === "cancelled" && <button className="secondary-formation-button" disabled={saving} onClick={() => restore(selectedAppointment)}><RotateCcw size={15}/> Restaurar</button>}
        {!selectedAppointment.hasClinicalEvidence && (selectedAppointment.status === "scheduled" || selectedAppointment.status === "cancelled") && <button className="secondary-formation-button delete-management" disabled={saving} onClick={() => openDeletion(selectedAppointment)}><Trash2 size={15}/> Eliminar del calendario</button>}
      </div>
    </section></ModalLayer>}

    {draft && !compact && <ModalLayer onDismiss={() => setDraft(null)} className="modal-backdrop"><section className="calendar-modal" role="dialog" aria-modal="true" aria-labelledby="calendar-modal-title"><div className="modal-title"><div><p className="section-kicker">Agenda clínica</p><h2 id="calendar-modal-title">{draft.id ? "Editar sesión programada" : "Programar sesión"}</h2></div><button aria-label="Cerrar" onClick={() => setDraft(null)}><X size={19}/></button></div><div className="calendar-form-grid">
      <label><span>Niño</span><select autoFocus value={draft.profileId} onChange={(event) => setDraft({ ...draft, profileId: event.target.value, professionalAccountId: "" })}><option value="">Seleccionar niño</option>{activeProfiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.fullName} · {profile.site}</option>)}</select></label>
      <label><span>Profesional clínico</span><select value={draft.professionalAccountId} onChange={(event) => setDraft({ ...draft, professionalAccountId: event.target.value })}><option value="">Seleccionar profesional responsable</option>{eligibleProfessionals.map((professional) => <option value={professional.id} key={professional.id}>{professional.displayName} · {roleLabel(professional.role)}</option>)}</select>{draft.profileId && !eligibleProfessionals.length && <small>No hay profesionales con permiso y alcance clínico para este niño.</small>}</label>
      <label><span>Fecha</span><input type="date" value={draft.sessionDate} onChange={(event) => setDraft({ ...draft, sessionDate: event.target.value })}/></label>
      <label><span>Tipo de sesión</span><input value={draft.sessionType} onChange={(event) => setDraft({ ...draft, sessionType: event.target.value })} placeholder="Terapia individual"/></label>
      <label><span>Hora de inicio</span><input type="time" value={draft.startTime} onChange={(event) => setDraft({ ...draft, startTime: event.target.value })}/></label>
      <label><span>Hora de finalización</span><input type="time" value={draft.endTime} onChange={(event) => setDraft({ ...draft, endTime: event.target.value })}/></label>
      <label className="field-wide"><span>Notas u observaciones (opcional)</span><textarea value={draft.notes} onChange={(event) => setDraft({ ...draft, notes: event.target.value })} placeholder="Información necesaria para preparar la atención"/></label>
    </div><div className="calendar-form-note"><Clock3 size={16}/><p>La cita organiza el trabajo. Los resultados clínicos se guardan cuando el profesional asignado cierra la sesión.</p></div><div className="modal-actions"><button className="secondary-formation-button" onClick={() => setDraft(null)}>Cancelar</button><button className="primary-formation-button" disabled={saving || !draft.profileId || !draft.professionalAccountId} onClick={save}>{saving ? <LoaderCircle className="spin" size={16}/> : <CalendarDays size={16}/>} Guardar en calendario</button></div></section></ModalLayer>}
    {cancelTarget && !compact && <ModalLayer onDismiss={() => setCancelTarget(null)} className="modal-backdrop"><section className="calendar-modal cancellation-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-appointment-title"><div className="modal-title"><div><p className="section-kicker">Conservar incidencia</p><h2 id="cancel-appointment-title">Cancelar sesión</h2></div><button aria-label="Cerrar" onClick={() => setCancelTarget(null)}><X size={19}/></button></div><p className="calendar-action-summary"><strong>{cancelTarget.profileName}</strong> · {cancelTarget.sessionDate} · {cancelTarget.startTime}–{cancelTarget.endTime}</p><div className="calendar-form-grid"><label className="field-wide"><span>Categoría de cancelación</span><select autoFocus value={cancellationCategory} onChange={(event) => setCancellationCategory(event.target.value as CancellationCategory | "")}><option value="">Seleccionar categoría</option>{CANCELLATION_CATEGORIES.map((category) => <option value={category.value} key={category.value}>{category.label}</option>)}</select></label><label className="field-wide"><span>Justificación {cancellationCategory === "other" ? "(obligatoria)" : "(opcional)"}</span><textarea value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} maxLength={1000} placeholder={cancellationCategory === "other" ? "Describe el motivo de la cancelación" : "Detalle adicional"}/></label></div><div className="calendar-form-note warning"><Ban size={16}/><p>La sesión quedará marcada como cancelada y conservará el horario, la categoría y cualquier justificación en el historial.</p></div><div className="modal-actions"><button className="secondary-formation-button" onClick={() => setCancelTarget(null)}>Volver</button><button className="cancel-confirm-button" disabled={saving || !cancellationCategory || (cancellationCategory === "other" && !cancellationReason.trim())} onClick={cancel}>{saving ? <LoaderCircle className="spin" size={16}/> : <Ban size={16}/>} Confirmar cancelación</button></div></section></ModalLayer>}
    {deleteTarget && !compact && <ModalLayer onDismiss={() => setDeleteTarget(null)} className="modal-backdrop"><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-appointment-title"><span className="danger-mark"><Trash2 size={22}/></span><h2 id="delete-appointment-title">Eliminar cita administrativa</h2><p>Se quitará del calendario la cita de <strong>{deleteTarget.profileName}</strong> del {deleteTarget.sessionDate}, de {deleteTarget.startTime} a {deleteTarget.endTime}. Esta acción no elimina evidencia clínica y sólo se completará si la cita continúa siendo administrativa.</p><div><button className="secondary-formation-button" onClick={() => setDeleteTarget(null)}>Volver</button><button className="danger-button" disabled={saving} onClick={remove}>{saving ? <LoaderCircle className="spin" size={16}/> : <Trash2 size={16}/>} Eliminar del calendario</button></div></section></ModalLayer>}
  </div>;
}
