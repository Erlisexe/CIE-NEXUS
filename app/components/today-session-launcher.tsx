"use client";

import { useEffect, useRef, useState } from "react";
import { Play, X } from "lucide-react";
import { clientRequest } from "../../lib/client-request";
import { collectionDateTime, type CollectionDraft, type CollectionPreparation } from "../../lib/mobile-collection";
import type { TodayCollectionAppointment } from "../../lib/web-session-collection-server";
import ModalLayer from "./modal-layer";
import RealSessionCollector, { RealSessionSetup, type SessionSetupValue } from "./real-session-collector";

export function StartTodaySessionButton({ onClick, className = "primary-formation-button", continuing = false }: { onClick: () => void; className?: string; continuing?: boolean }) {
  return <button type="button" className={`${className} start-today-session`} onClick={onClick}><Play size={16}/>{continuing ? "Continuar sesión" : "Iniciar sesión de hoy"}</button>;
}

export default function TodaySessionLauncher({ profileId, profileName, appointmentId = null, notify, onExit, onFinished }: {
  profileId: string;
  profileName: string;
  appointmentId?: string | null;
  notify: (message: string) => void;
  onExit: () => void;
  onFinished: () => void;
}) {
  const [selectedAppointmentId, setSelectedAppointmentId] = useState(appointmentId);
  const [appointments, setAppointments] = useState<TodayCollectionAppointment[]>([]);
  const [preparation, setPreparation] = useState<CollectionPreparation | null>(null);
  const [draft, setDraft] = useState<CollectionDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [starting, setStarting] = useState(false);
  const startLock = useRef(false);
  const [value, setValue] = useState<SessionSetupValue>({ profileId, sessionDate: collectionDateTime(new Date()).date, contextCategory: "", contextOther: "", noteTemplateId: "", selectedTargetIds: [] });

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ profileId, today: "1" });
    if (selectedAppointmentId) query.set("appointmentId", selectedAppointmentId);
    clientRequest(`/api/session-collection?${query}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { preparation?: CollectionPreparation; draft?: CollectionDraft; appointments?: TodayCollectionAppointment[]; error?: string };
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(body.error || "No se pudo preparar la sesión de hoy.");
        if (body.draft) { setDraft(body.draft); return; }
        if (body.appointments?.length && !body.preparation) { setAppointments(body.appointments); return; }
        if (!body.preparation) throw new Error("No se pudo preparar la sesión de hoy.");
        const prepared = body.preparation;
        setPreparation(prepared);
        setValue((current) => ({ ...current, sessionDate: prepared.appointment?.sessionDate || prepared.sessionDate || collectionDateTime(new Date()).date, noteTemplateId: prepared.templates.some((template) => template.id === current.noteTemplateId) ? current.noteTemplateId : prepared.templates[0]?.id || "", selectedTargetIds: current.selectedTargetIds.filter((id) => prepared.programs.some((program) => program.targets.some((target) => target.id === id))) }));
      })
      .catch((cause: Error) => { if (!controller.signal.aborted) setError(cause.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [profileId, selectedAppointmentId, revision]);

  function retry() { setError(""); setLoading(true); setPreparation(null); setRevision((current) => current + 1); }
  async function start() {
    if (!preparation || loading || error || startLock.current) return;
    startLock.current = true; setStarting(true);
    try {
      const response = await clientRequest("/api/session-collection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "start", ...value, appointmentId: preparation.appointment?.id || null }) });
      const body = await response.json() as { draft?: CollectionDraft; error?: string };
      if (!response.ok || !body.draft) throw new Error(body.error || "No se pudo iniciar la sesión.");
      setDraft(body.draft);
    } catch (cause) { notify(cause instanceof Error ? cause.message : "No se pudo iniciar la sesión."); }
    finally { startLock.current = false; setStarting(false); }
  }
  function finish(message: string) { onFinished(); onExit(); notify(message); }

  if (draft) return <RealSessionCollector initialDraft={draft} notify={notify} onClosed={() => finish("Sesión cerrada y guardada en el expediente.")} onDiscarded={() => finish("Sesión vacía descartada.")}/>;
  if (appointments.length && !loading && !error && !preparation) return <ModalLayer onDismiss={onExit} className="modal-backdrop real-setup-backdrop"><section className="real-session-setup today-session-choice" role="dialog" aria-modal="true" aria-labelledby="today-session-title">
    <header><div><p className="section-kicker">Sesiones de hoy</p><h2 id="today-session-title">Elige la cita</h2><span>{profileName}</span></div><button type="button" aria-label="Cerrar selección de cita" onClick={onExit}><X size={20}/></button></header>
    <div className="today-appointment-list">{appointments.map((appointment) => <button type="button" key={appointment.id} onClick={() => { setLoading(true); setAppointments([]); setSelectedAppointmentId(appointment.id); }}><span><strong>{appointment.startTime}–{appointment.endTime}</strong><small>{appointment.sessionType}</small></span><span>{appointment.inProgress ? "Continuar sesión" : "Preparar sesión"}</span></button>)}</div>
    <footer><button className="secondary-formation-button" onClick={onExit}>Volver</button></footer>
  </section></ModalLayer>;
  return <RealSessionSetup preparation={preparation} loading={loading} value={value} starting={starting} error={error} onRetry={retry} profileOptions={[{ id: profileId, label: profileName }]} onChange={setValue} onClose={() => { if (!startLock.current) onExit(); }} onStart={start}/>;
}
