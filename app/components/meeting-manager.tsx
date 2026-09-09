"use client";

import { CalendarClock, Check, ChevronLeft, ChevronRight, Clock3, LoaderCircle, MailQuestion, Send, UserRound, X } from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { meetingStatusLabel, todayInNicaragua } from "../../lib/meetings";
import { roleLabel, type AppRole } from "../../lib/access-control";

type MeetingRecipient = { id: string; displayName: string; email: string; role: AppRole };
type BusyBlock = { id: string; date: string; startTime: string; endTime: string; source: "session" | "meeting" };
type MeetingRequest = {
  id: string;
  requesterAccountId: string;
  recipientAccountId: string;
  requesterName: string;
  requesterEmail: string;
  recipientName: string;
  recipientEmail: string;
  recipientRole: AppRole | null;
  meetingDate: string;
  startTime: string;
  endTime: string;
  subject: string;
  description: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
  createdAt: string;
  history?: Array<{id:string;status:MeetingRequest["status"];at:string}>;
};

type MeetingsResponse = {
  recipients?: MeetingRecipient[];
  requests?: MeetingRequest[];
  busyBlocks?: BusyBlock[];
  currentAccountId?: string;
  error?: string;
};

function isoDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDate(value: string) {
  return new Date(`${value}T12:00:00`);
}

function shiftDay(value: string, amount: number) {
  const date = localDate(value);
  date.setDate(date.getDate() + amount);
  return isoDate(date);
}

function weekStart(value: string) {
  const date = localDate(value);
  const weekday = date.getDay();
  date.setDate(date.getDate() + (weekday === 0 ? -6 : 1 - weekday));
  return isoDate(date);
}

function statusTone(status: MeetingRequest["status"]) {
  return `meeting-status ${status}`;
}

export default function MeetingManager({ notify }: { notify: (message: string) => void }) {
  const today = useMemo(() => todayInNicaragua(), []);
  const [recipients, setRecipients] = useState<MeetingRecipient[]>([]);
  const [requests, setRequests] = useState<MeetingRequest[]>([]);
  const [busyBlocks, setBusyBlocks] = useState<BusyBlock[]>([]);
  const [currentAccountId, setCurrentAccountId] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [meetingDate, setMeetingDate] = useState(today);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("09:30");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const notifyRef = useRef(notify);
  const loadRevision = useRef(0);
  useEffect(() => { notifyRef.current = notify; }, [notify]);

  const from = weekStart(meetingDate);
  const to = shiftDay(from, 6);
  const days = Array.from({ length: 7 }, (_, index) => shiftDay(from, index));

  const load = useCallback(async (selectedRecipientId: string, selectedDate: string) => {
    const revision = ++loadRevision.current;
    setLoading(true);
    try {
      const rangeFrom = weekStart(selectedDate);
      const rangeTo = shiftDay(rangeFrom, 6);
      const query = new URLSearchParams({ from: rangeFrom, to: rangeTo });
      if (selectedRecipientId) query.set("recipientId", selectedRecipientId);
      const response = await fetch(`/api/meetings?${query}`, { cache: "no-store" });
      const data = await response.json() as MeetingsResponse;
      if (revision !== loadRevision.current) return;
      if (!response.ok) throw new Error(data.error || "No se pudo cargar la agenda de reuniones.");
      const nextRecipients = data.recipients || [];
      setRecipients(nextRecipients);
      setRequests(data.requests || []);
      setBusyBlocks(data.busyBlocks || []);
      setCurrentAccountId(data.currentAccountId || "");
      if (!selectedRecipientId && nextRecipients.length) setRecipientId(nextRecipients[0].id);
    } catch (error) {
      if (revision === loadRevision.current) notifyRef.current(error instanceof Error ? error.message : "No se pudo cargar la agenda de reuniones.");
    } finally {
      if (revision === loadRevision.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(recipientId, meetingDate); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, meetingDate, recipientId]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch("/api/meetings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientAccountId: recipientId, meetingDate, startTime, endTime, subject, description }),
      });
      const data = await response.json() as { request?: MeetingRequest; error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo solicitar la reunión.");
      setSubject("");
      setDescription("");
      notify("Solicitud de reunión enviada.");
      await load(recipientId, meetingDate);
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo solicitar la reunión.");
    } finally {
      setSaving(false);
    }
  }

  async function updateRequest(id: string, action: "accept" | "decline" | "cancel") {
    setSaving(true);
    try {
      const response = await fetch("/api/meetings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const data = await response.json() as { request?: MeetingRequest; error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo actualizar la solicitud.");
      notify(action === "accept" ? "Reunión aceptada." : action === "decline" ? "Solicitud rechazada." : "Solicitud cancelada.");
      await load(recipientId, meetingDate);
    } catch (error) {
      notify(error instanceof Error ? error.message : "No se pudo actualizar la solicitud.");
    } finally {
      setSaving(false);
    }
  }

  const incoming = requests.filter((item) => item.recipientAccountId === currentAccountId);
  const outgoing = requests.filter((item) => item.requesterAccountId === currentAccountId);
  const selectedRecipient = recipients.find((item) => item.id === recipientId) || null;

  return <div className="meeting-module">
    <div className="formation-heading"><div><p className="section-kicker">Coordinación profesional</p><h1>Reunión</h1><p>Consulta espacios ocupados y solicita una reunión a Subdirección o Dirección Clínica.</p></div></div>

    <div className="meeting-layout">
      <section className="formation-panel meeting-agenda">
        <header className="meeting-panel-head"><div><p className="section-kicker">Disponibilidad</p><h2>Agenda del destinatario</h2></div><label><span>Profesional</span><select value={recipientId} onChange={(event) => setRecipientId(event.target.value)}><option value="">Seleccionar destinatario</option>{recipients.map((recipient) => <option value={recipient.id} key={recipient.id}>{recipient.displayName} · {roleLabel(recipient.role)} · {recipient.email}</option>)}</select></label></header>
        {!recipients.length && !loading ? <div className="meeting-empty"><UserRound size={28}/><strong>No hay destinatarios disponibles.</strong><p>La lista aparecerá cuando exista otro subdirector o integrante de Dirección Clínica con cuenta activa.</p></div> : <>
          <div className="meeting-week-toolbar"><button aria-label="Semana anterior" onClick={() => setMeetingDate(shiftDay(meetingDate, -7))}><ChevronLeft size={17}/></button><button onClick={() => setMeetingDate(today)}>Hoy</button><strong>{localDate(from).toLocaleDateString("es-NI", { day: "2-digit", month: "short" })}–{localDate(to).toLocaleDateString("es-NI", { day: "2-digit", month: "short", year: "numeric" })}</strong><button aria-label="Semana siguiente" onClick={() => setMeetingDate(shiftDay(meetingDate, 7))}><ChevronRight size={17}/></button></div>
          {loading ? <div className="meeting-empty"><LoaderCircle className="spin" size={27}/><strong>Cargando disponibilidad…</strong></div> : <div className="meeting-week">{days.map((day) => {
            const blocks = busyBlocks.filter((item) => item.date === day);
            return <button type="button" className={day === meetingDate ? "selected" : ""} key={day} onClick={() => setMeetingDate(day)}><span>{localDate(day).toLocaleDateString("es-NI", { weekday: "short" })}</span><strong>{localDate(day).toLocaleDateString("es-NI", { day: "2-digit", month: "short" })}</strong><div>{blocks.length ? blocks.map((block) => <em key={`${block.source}-${block.id}`}><Clock3 size={11}/>{block.startTime}–{block.endTime} · No disponible</em>) : <small>Sin bloques ocupados</small>}</div></button>;
          })}</div>}
          <div className="meeting-privacy-note"><CalendarClock size={16}/><p>La agenda muestra únicamente horarios ocupados. No revela niños, asuntos clínicos ni el contenido de otras reuniones.</p></div>
        </>}
      </section>

      <section className="formation-panel meeting-request-card">
        <div className="meeting-panel-head"><div><p className="section-kicker">Nueva solicitud</p><h2>Solicitar reunión</h2></div><MailQuestion size={21}/></div>
        <form onSubmit={submit}>
          <label className="field-wide"><span>Dirigida a</span><input readOnly value={selectedRecipient ? `${selectedRecipient.displayName} · ${roleLabel(selectedRecipient.role)}` : "Selecciona un destinatario en la agenda"}/></label>
          <label><span>Fecha</span><input type="date" min={today} required value={meetingDate} onChange={(event) => setMeetingDate(event.target.value)}/></label>
          <div className="meeting-time-fields"><label><span>Inicio</span><input type="time" required value={startTime} onChange={(event) => setStartTime(event.target.value)}/></label><label><span>Fin</span><input type="time" required value={endTime} onChange={(event) => setEndTime(event.target.value)}/></label></div>
          <label className="field-wide"><span>Asunto</span><input required maxLength={160} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Motivo principal de la reunión"/></label>
          <label className="field-wide"><span>Descripción</span><textarea required maxLength={3000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Incluye el contexto necesario para que el destinatario pueda valorar la solicitud."/></label>
          <button className="primary-formation-button" disabled={saving || !recipientId || endTime <= startTime}>{saving ? <LoaderCircle className="spin" size={16}/> : <Send size={16}/>} Enviar solicitud</button>
        </form>
      </section>
    </div>

    <div className="meeting-request-lists">
      <MeetingList title="Solicitudes recibidas" empty="No tienes solicitudes recibidas." rows={incoming} perspective="incoming" busy={saving} onAction={updateRequest}/>
      <MeetingList title="Mis solicitudes" empty="Todavía no has solicitado reuniones." rows={outgoing} perspective="outgoing" busy={saving} onAction={updateRequest}/>
    </div>
  </div>;
}

function MeetingList({ title, empty, rows, perspective, busy, onAction }: {
  title: string;
  empty: string;
  rows: MeetingRequest[];
  perspective: "incoming" | "outgoing";
  busy: boolean;
  onAction: (id: string, action: "accept" | "decline" | "cancel") => void;
}) {
  return <section className="formation-panel meeting-list"><header><div><p className="section-kicker">Seguimiento</p><h2>{title}</h2></div><span>{rows.length}</span></header>{rows.length ? <div>{rows.map((item) => <article key={item.id}><div className="meeting-request-date"><strong>{localDate(item.meetingDate).toLocaleDateString("es-NI", { day: "2-digit", month: "short", year: "numeric" })}</strong><span>{item.startTime}–{item.endTime}</span></div><div className="meeting-request-copy"><strong>{item.subject}</strong><small>{perspective === "incoming" ? `Solicita: ${item.requesterName}` : `Dirigida a: ${item.recipientName}`}</small><p>{item.description}</p>{Boolean(item.history?.length) && <details><summary>Historial de estados</summary>{item.history!.map(entry=><p key={entry.id}>{meetingStatusLabel(entry.status)} · {new Date(entry.at.includes("T") ? entry.at : entry.at.replace(" ","T")+"Z").toLocaleString("es-NI",{timeZone:"America/Managua"})}</p>)}</details>}</div><span className={statusTone(item.status)}>{meetingStatusLabel(item.status)}</span><div className="meeting-request-actions">{perspective === "incoming" && item.status === "pending" && <><button className="accept" disabled={busy} onClick={() => onAction(item.id, "accept")}><Check size={14}/>Aceptar</button><button disabled={busy} onClick={() => onAction(item.id, "decline")}><X size={14}/>Rechazar</button></>}{perspective === "outgoing" && (item.status === "pending" || item.status === "accepted") && <button disabled={busy} onClick={() => onAction(item.id, "cancel")}><X size={14}/>Cancelar</button>}</div></article>)}</div> : <div className="meeting-empty compact"><CalendarClock size={25}/><strong>{empty}</strong></div>}</section>;
}
