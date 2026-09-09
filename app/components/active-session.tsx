"use client";

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FileText,
  HeartHandshake,
  ListChecks,
  Minus,
  Pause,
  Play,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  TimerReset,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type Trial = "independent" | "prompted" | "incorrect";

function formatTime(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function ActiveSession({ onExit }: { onExit: () => void }) {
  const [sessionRunning, setSessionRunning] = useState(true);
  const [sessionSeconds, setSessionSeconds] = useState(0);
  const [instructionsOpen, setInstructionsOpen] = useState(true);
  const [trials, setTrials] = useState<Record<Trial, number>>({ independent: 0, prompted: 0, incorrect: 0 });
  const [frequency, setFrequency] = useState(0);
  const [duration, setDuration] = useState(0);
  const [durationRunning, setDurationRunning] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    if (!sessionRunning) return;
    const interval = window.setInterval(() => setSessionSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(interval);
  }, [sessionRunning]);

  useEffect(() => {
    if (!durationRunning) return;
    const interval = window.setInterval(() => setDuration((value) => value + 1), 1000);
    return () => window.clearInterval(interval);
  }, [durationRunning]);

  const totalTrials = trials.independent + trials.prompted + trials.incorrect;
  const independence = totalTrials ? Math.round((trials.independent / totalTrials) * 100) : 0;

  const generatedNote = useMemo(() => {
    const minutes = Math.max(1, Math.round(sessionSeconds / 60));
    return `Durante ${minutes} minuto${minutes === 1 ? "" : "s"} de sesión se registraron ${totalTrials} oportunidades en mandos funcionales: ${trials.independent} respuestas independientes, ${trials.prompted} con ayuda y ${trials.incorrect} respuesta${trials.incorrect === 1 ? "" : "s"} incorrecta${trials.incorrect === 1 ? "" : "s"} (${independence}% de independencia). Se registraron ${frequency} ocurrencias durante transiciones y ${duration} segundo${duration === 1 ? "" : "s"} acumulado${duration === 1 ? "" : "s"} de tolerancia a la demora. [Complete actividades realizadas, variables contextuales e incidentes antes de firmar].`;
  }, [duration, frequency, independence, sessionSeconds, totalTrials, trials]);

  function addTrial(trial: Trial) {
    setTrials((current) => ({ ...current, [trial]: current[trial] + 1 }));
  }

  function openSummary() {
    setSessionRunning(false);
    setDurationRunning(false);
    setNote(generatedNote);
    setSummaryOpen(true);
  }

  async function saveDraft() {
    setSaveState("saving");
    try {
      const response = await fetch("/api/session-records", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientCode: "MR-024",
          clientName: "Mateo R.",
          durationMinutes: Math.max(1, Math.round(sessionSeconds / 60)),
          independentCount: trials.independent,
          promptedCount: trials.prompted,
          incorrectCount: trials.incorrect,
          transitionsFrequency: frequency,
          toleranceSeconds: duration,
          draftNote: note,
        }),
      });
      if (!response.ok) throw new Error("No se pudo guardar");
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return (
    <div className="session-shell">
      <header className="session-topbar">
        <button className="icon-button" onClick={onExit} aria-label="Volver al panel"><ArrowLeft size={19} /></button>
        <span className="avatar">MR</span>
        <div className="session-client"><strong>Mateo R.</strong><small>Sesión de intervención · Sala 3</small></div>
        <div className="session-clock"><i /><Clock3 size={16} /><strong>{formatTime(sessionSeconds)}</strong></div>
        <button className="finish-button" onClick={openSummary}>Finalizar sesión</button>
      </header>

      <main className="session-main">
        <section className="session-strip">
          <div><small>Programas de hoy</small><strong>3 activos</strong></div>
          <div><small>Datos registrados</small><strong>{totalTrials + frequency + (duration ? 1 : 0)}</strong></div>
          <div><small>Independencia</small><strong>{independence}%</strong></div>
          <div className="version-state"><CheckCircle2 size={16} /><span>Versión vigente · Sin conflictos</span></div>
        </section>

        <div className="session-layout">
          <section className="program-stack">
            <article className="data-card active-data-card">
              <div className="data-card-heading">
                <div><p className="eyebrow">Comunicación funcional</p><h1>Mandos para pedir descanso</h1><small>Target: frase de 2 palabras · Ensayos discretos</small></div>
                <span className="version-pill">Versión 3</span>
              </div>
              <button className="instruction-toggle" onClick={() => setInstructionsOpen((value) => !value)}>
                <span><ListChecks size={17} /> Instrucciones del programa</span><ChevronDown size={17} className={instructionsOpen ? "rotate" : ""} />
              </button>
              {instructionsOpen && <div className="instruction-panel"><ol><li>Disponga el pictograma de descanso dentro del campo visual.</li><li>Presente una tarea programada y espere hasta 5 segundos.</li><li>Registre el nivel de respuesta inmediatamente.</li></ol><p><ShieldCheck size={15} /> Componente crítico: no retirar la demanda antes de registrar.</p></div>}
              <div className="trial-summary"><div><small>Oportunidades</small><strong>{totalTrials}</strong></div><div><small>Independencia</small><strong>{independence}%</strong></div></div>
              <div className="trial-grid">
                <button className="trial good" onClick={() => addTrial("independent")}><span><Check size={21} /></span><strong>Independiente</strong><small>{trials.independent} registros</small></button>
                <button className="trial prompted" onClick={() => addTrial("prompted")}><span><HeartHandshake size={21} /></span><strong>Con ayuda</strong><small>{trials.prompted} registros</small></button>
                <button className="trial incorrect" onClick={() => addTrial("incorrect")}><span><X size={21} /></span><strong>Incorrecto</strong><small>{trials.incorrect} registros</small></button>
              </div>
            </article>

            <article className="data-card compact-data-card">
              <div className="data-card-heading"><div><p className="eyebrow">Tolerancia y flexibilidad</p><h2>Transiciones entre actividades</h2><small>Conteo de ocurrencias · Frecuencia</small></div><span className="risk-pill">Alto riesgo</span></div>
              <div className="frequency-control"><button aria-label="Restar ocurrencia" onClick={() => setFrequency((value) => Math.max(0, value - 1))}><Minus size={21} /></button><div><strong>{frequency}</strong><small>ocurrencias</small></div><button aria-label="Agregar ocurrencia" onClick={() => setFrequency((value) => value + 1)}><Plus size={21} /></button></div>
            </article>

            <article className="data-card compact-data-card">
              <div className="data-card-heading"><div><p className="eyebrow">Habilidades adaptativas</p><h2>Tolerancia a la demora</h2><small>Tiempo acumulado · Duración</small></div><span className="goal-pill">Meta 01:00</span></div>
              <div className="duration-control"><strong>{formatTime(duration)}</strong><button className={durationRunning ? "secondary-action" : "primary-action"} onClick={() => setDurationRunning((value) => !value)}>{durationRunning ? <Pause size={16} /> : <Play size={16} />}{durationRunning ? "Pausar" : "Iniciar"}</button><button className="icon-button" onClick={() => { setDurationRunning(false); setDuration(0); }} aria-label="Reiniciar duración"><TimerReset size={18} /></button></div>
            </article>
          </section>

          <aside className="session-aside">
            <section><h3><ClipboardCheck size={17} /> Verificación previa</h3><ul><li><CheckCircle2 size={15} /> Programas vigentes</li><li><CheckCircle2 size={15} /> Materiales confirmados</li><li><CheckCircle2 size={15} /> Plan de seguridad disponible</li><li><CheckCircle2 size={15} /> Sin datos pendientes</li></ul></section>
            <section className="risk-aside"><h3><AlertTriangle size={17} /> Control de riesgo</h3><p>Interrumpir ante retiro de assent, criterio individual de riesgo o fallo crítico.</p><button>Abrir plan de seguridad <ChevronRight size={14} /></button></section>
            <section><h3><FileText size={17} /> Eventos contextuales</h3><button className="secondary-wide"><Plus size={15} /> Registrar evento</button></section>
          </aside>
        </div>
      </main>

      {summaryOpen && <div className="modal-backdrop"><section className="summary-modal" role="dialog" aria-modal="true" aria-label="Cierre de sesión"><div className="modal-heading"><div><p className="eyebrow">Cierre de sesión</p><h2>Revisar borrador antes de guardar</h2></div><button className="icon-button" onClick={() => setSummaryOpen(false)} aria-label="Cerrar"><X size={19} /></button></div><span className="ai-label"><Sparkles size={15} /> Borrador asistido · Solo datos registrados</span><textarea value={note} onChange={(event) => setNote(event.target.value)} aria-label="Nota de sesión" /><div className="source-box"><strong>Fuentes utilizadas</strong><span>{totalTrials + frequency + (duration ? 1 : 0)} eventos · Programas v2–v4 · 6 ago 2026</span></div><div className="missing-box"><AlertTriangle size={16} /><span>Complete actividades, variables contextuales e incidentes. La IA no firma ni declara resultados clínicos.</span></div><div className="modal-actions"><button className="secondary-action" onClick={() => { setSummaryOpen(false); setSessionRunning(true); }}>Volver a la sesión</button><button className="primary-action" onClick={saveDraft} disabled={saveState === "saving"}>{saveState === "saved" ? <CheckCircle2 size={16} /> : <Save size={16} />}{saveState === "saving" ? "Guardando…" : saveState === "saved" ? "Borrador guardado" : "Guardar borrador"}</button></div>{saveState === "error" && <p className="save-error">No se pudo guardar. Los datos siguen visibles para reintentar.</p>}</section></div>}
    </div>
  );
}
