"use client";

import {
  Activity,
  AlertTriangle,
  Bell,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Home,
  Menu,
  Play,
  Search,
  Settings,
  ShieldCheck,
  Target,
  UsersRound,
  X,
} from "lucide-react";
import { useState } from "react";
import ActiveSession from "./active-session";
import ModuleView from "./module-views";

const navigation = [
  ["Inicio", Home],
  ["Clientes", UsersRound],
  ["Sesiones", CalendarDays],
  ["Programas", BookOpenCheck],
  ["Monitoreo", Activity],
  ["Calidad clínica", ShieldCheck],
] as const;

const sessions = [
  { time: "8:00", end: "10:00", initials: "MR", client: "Mateo R.", room: "Sala 3", programs: 3, status: "Lista", tone: "good" },
  { time: "10:30", end: "12:00", initials: "SM", client: "Sofía M.", room: "Sala 1", programs: 4, status: "Por preparar", tone: "warn" },
  { time: "1:00", end: "3:00", initials: "DA", client: "Diego A.", room: "Sala 4", programs: 5, status: "Revisión", tone: "danger" },
];

const programs = [
  { area: "Comunicación funcional", name: "Mandos para pedir descanso", measure: "Ensayos discretos", progress: 78, points: "4,36 22,32 40,33 58,24 76,19 94,14 112,9" },
  { area: "Tolerancia y flexibilidad", name: "Transiciones entre actividades", measure: "Frecuencia", progress: 64, points: "4,34 22,30 40,32 58,27 76,24 94,20 112,17" },
  { area: "Habilidades adaptativas", name: "Tolerancia a la demora", measure: "Duración", progress: 71, points: "4,39 22,35 40,31 58,29 76,21 94,18 112,13" },
];

function Status({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`status status-${tone}`}>{children}</span>;
}

export default function ClinicalDashboard({ userName }: { userName: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeNav, setActiveNav] = useState("Inicio");
  const [activeSession, setActiveSession] = useState(false);

  if (activeSession) {
    return <ActiveSession onExit={() => setActiveSession(false)} />;
  }

  return (
    <div className="app-shell">
      {menuOpen && <button className="scrim" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <span className="brand-icon"><Activity size={21} /></span>
          <div><strong>CIETrack</strong><small>Clínica ABA</small></div>
          <button className="close-menu" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)}><X size={19} /></button>
        </div>
        <div className="phase"><i /> Fase 0 · Datos ficticios</div>
        <p className="nav-label">Espacio clínico</p>
        <nav aria-label="Navegación principal">
          {navigation.map(([label, Icon]) => (
            <button
              key={label}
              className={`nav-item ${activeNav === label ? "active" : ""}`}
              onClick={() => { setActiveNav(label); setMenuOpen(false); }}
            >
              <Icon size={18} /><span>{label}</span>
              {(label === "Sesiones" || label === "Calidad clínica") && <em>{label === "Sesiones" ? 4 : 2}</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-grow" />
        <button className="nav-item"><Settings size={18} /><span>Configuración</span></button>
        <div className="user-row"><span className="avatar user-avatar">ER</span><div><strong>{userName}</strong><small>Subdirector clínico</small></div><ChevronRight size={16} /></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <button className="menu-button" aria-label="Abrir menú" onClick={() => setMenuOpen(true)}><Menu size={21} /></button>
          <label className="search"><Search size={18} /><input placeholder="Buscar cliente, programa o sesión…" aria-label="Buscar" /></label>
          <div className="topbar-right"><button className="icon-button" aria-label="Notificaciones"><Bell size={19} /><i /></button><span className="date"><CalendarDays size={17} /> Jue, 6 ago</span></div>
        </header>

        <main className="content">
          {activeNav === "Inicio" ? <>
          <div className="page-heading">
            <div><p className="eyebrow">Panel clínico</p><h1>Buenos días, {userName}</h1><p>Aquí está lo que requiere atención hoy, priorizado por evidencia y riesgo.</p></div>
            <button className="primary-button"><CalendarDays size={17} /> Ver agenda</button>
          </div>

          <section className="priority-banner">
            <span className="priority-icon"><ShieldCheck size={21} /></span>
            <div><strong>2 revisiones clínicas requieren atención</strong><small>Una por fidelidad insuficiente y otra por transición de alto riesgo.</small></div>
            <button>Revisar ahora <ChevronRight size={16} /></button>
          </section>

          <section className="metrics">
            <article><span className="metric-icon green"><CalendarDays size={20} /></span><div><small>Sesiones de hoy</small><strong>4</strong><em>6.5 horas programadas</em></div></article>
            <article><span className="metric-icon blue"><Target size={20} /></span><div><small>Programas activos</small><strong>18</strong><em>3 próximos a revisión</em></div></article>
            <article><span className="metric-icon amber"><ClipboardCheck size={20} /></span><div><small>Fidelidad media</small><strong>93%</strong><em className="positive">+4% vs. semana anterior</em></div></article>
            <article><span className="metric-icon coral"><AlertTriangle size={20} /></span><div><small>Alertas abiertas</small><strong>2</strong><em>1 de alta prioridad</em></div></article>
          </section>

          <div className="dashboard-grid">
            <section className="panel schedule-panel">
              <div className="panel-heading"><div><p className="eyebrow">Agenda clínica</p><h2>Próximas sesiones</h2></div><button>Ver todas <ChevronRight size={15} /></button></div>
              <div className="session-list">
                {sessions.map((session, index) => (
                  <div className="session-row" key={session.client}>
                    <div className="time"><strong>{session.time}</strong><small>{session.end}</small></div>
                    <span className={`avatar avatar-${index + 1}`}>{session.initials}</span>
                    <div className="session-info"><strong>{session.client}</strong><small>{session.room} · {session.programs} programas</small></div>
                    <Status tone={session.tone}>{session.status}</Status>
                    {index === 0 ? <button className="start-button" onClick={() => setActiveSession(true)}><Play size={14} /> Iniciar</button> : <button className="icon-button"><ChevronRight size={17} /></button>}
                  </div>
                ))}
              </div>
            </section>

            <section className="panel attention-panel">
              <div className="panel-heading"><div><p className="eyebrow">Priorización</p><h2>Necesita revisión</h2></div><span className="count">2 pendientes</span></div>
              <div className="attention-list">
                <button><span className="attention-icon danger"><AlertTriangle size={17} /></span><span><strong>Fidelidad por debajo del criterio</strong><small>Transiciones · 84% global · hace 1 día</small></span><ChevronRight size={17} /></button>
                <button><span className="attention-icon warn"><ShieldCheck size={17} /></span><span><strong>Revisión de transición pendiente</strong><small>30 días completados · requiere supervisor</small></span><ChevronRight size={17} /></button>
                <button><span className="attention-icon blue"><CheckCircle2 size={17} /></span><span><strong>Programa listo para aprobar</strong><small>Mandos funcionales v3 · borrador revisado</small></span><ChevronRight size={17} /></button>
              </div>
            </section>
          </div>

          <section className="panel progress-panel">
            <div className="panel-heading"><div><p className="eyebrow">Últimos 30 días</p><h2>Progreso de programas priorizados</h2></div><button>Abrir monitoreo <ChevronRight size={15} /></button></div>
            <div className="program-list">
              {programs.map((program) => (
                <div className="program-row" key={program.name}>
                  <div><small>{program.area}</small><strong>{program.name}</strong></div>
                  <Status tone="neutral">{program.measure}</Status>
                  <svg viewBox="0 0 116 44" aria-label={`Tendencia de ${program.name}`}><path d="M2 40H114" /><polyline points={program.points} /></svg>
                  <div className="program-value"><strong>{program.progress}%</strong><small>último dato</small></div>
                  <button className="icon-button"><ChevronRight size={17} /></button>
                </div>
              ))}
            </div>
          </section>
          </> : <ModuleView activeNav={activeNav} onStart={() => setActiveSession(true)} onNavigate={setActiveNav} />}
        </main>
      </section>
    </div>
  );
}
