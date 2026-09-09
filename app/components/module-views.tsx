"use client";

import {
  AlertTriangle,
  BookOpenCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Play,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

const clients = [
  ["MR", "Mateo R.", "MR-024", "6 programas", "Hoy, 8:00", "Alto riesgo"],
  ["SM", "Sofía M.", "SM-018", "8 programas", "Hoy, 10:30", "Ordinario"],
  ["DA", "Diego A.", "DA-031", "5 programas", "Hoy, 1:00", "Revisión"],
  ["VG", "Valentina G.", "VG-027", "7 programas", "Hoy, 3:30", "Ordinario"],
];

const programCards = [
  ["Comunicación funcional", "Mandos para pedir descanso", "Ensayos discretos", "Frase de 2 palabras", "v3", "78%", "Ordinario"],
  ["Tolerancia y flexibilidad", "Transiciones entre actividades", "Frecuencia", "Transición con apoyo visual", "v2", "64%", "Alto riesgo"],
  ["Habilidades adaptativas", "Tolerancia a la demora", "Duración", "Espera durante 60 segundos", "v4", "71%", "Ordinario"],
];

const agenda = [
  ["8:00–10:00", "MR", "Mateo R.", "Ana P.", "Sala 3", "3", "Lista"],
  ["10:30–12:00", "SM", "Sofía M.", "Luis C.", "Sala 1", "4", "Por preparar"],
  ["1:00–3:00", "DA", "Diego A.", "María J.", "Sala 4", "5", "Revisión"],
  ["3:30–5:00", "VG", "Valentina G.", "Carlos T.", "Sala 2", "3", "Lista"],
];

function Header({ eyebrow, title, detail, action }: { eyebrow: string; title: string; detail: string; action?: React.ReactNode }) {
  return <div className="page-heading module-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{detail}</p></div>{action}</div>;
}

function Tag({ tone = "neutral", children }: { tone?: string; children: React.ReactNode }) {
  return <span className={`status status-${tone}`}>{children}</span>;
}

export default function ModuleView({ activeNav, onStart, onNavigate }: { activeNav: string; onStart: () => void; onNavigate: (value: string) => void }) {
  if (activeNav === "Sesiones") return <Sessions onStart={onStart} />;
  if (activeNav === "Programas") return <Programs />;
  if (activeNav === "Monitoreo") return <Monitoring />;
  if (activeNav === "Calidad clínica") return <Quality />;
  return <Clients onNavigate={onNavigate} />;
}

function Sessions({ onStart }: { onStart: () => void }) {
  return <><Header eyebrow="Sesiones" title="Agenda y recopilación de datos" detail="Abra una sesión, confirme la versión vigente y registre cada medida en contexto." action={<button className="primary-button"><Plus size={16} /> Agendar sesión</button>} /><div className="module-toolbar"><div className="segments"><button className="selected">Hoy</button><button>Semana</button><button>Mes</button></div><button className="filter-button"><CalendarDays size={16} /> 6 de agosto</button></div><section className="panel full-agenda"><div className="agenda-list">{agenda.map((item, index) => <div className="agenda-row" key={item[2]}><div className="agenda-time"><strong>{item[0].split("–")[0]}</strong><small>{item[0].split("–")[1]}</small></div><span className={`avatar avatar-${index + 1}`}>{item[1]}</span><div className="agenda-client"><strong>{item[2]}</strong><small>{item[3]} · {item[4]}</small></div><span className="agenda-programs"><BookOpenCheck size={15} /> {item[5]} programas</span><Tag tone={item[6] === "Lista" ? "good" : item[6] === "Revisión" ? "danger" : "warn"}>{item[6]}</Tag>{index === 0 ? <button className="primary-button" onClick={onStart}><Play size={15} /> Iniciar sesión</button> : <button className="filter-button">Preparar <ChevronRight size={15} /></button>}</div>)}</div></section></>;
}

function Clients({ onNavigate }: { onNavigate: (value: string) => void }) {
  return <><Header eyebrow="Niños" title="Casos activos" detail="Cada expediente mantiene separados sus programas, sesiones, fuentes y decisiones clínicas." action={<button className="primary-button"><Plus size={16} /> Nuevo niño</button>} /><div className="client-grid">{clients.map((client, index) => <article className="client-card" key={client[2]}><span className={`avatar client-avatar avatar-${index + 1}`}>{client[0]}</span><div className="client-title"><div><h2>{client[1]}</h2><small>{client[2]}</small></div><Tag tone={client[5] === "Alto riesgo" ? "warn" : client[5] === "Revisión" ? "danger" : "good"}>{client[5]}</Tag></div><div className="client-meta"><p><BookOpenCheck size={15} /> {client[3]} activos</p><p><CalendarDays size={15} /> Próxima: {client[4]}</p></div><button className="wide-button" onClick={() => onNavigate("Programas")}>Abrir expediente clínico <ChevronRight size={15} /></button></article>)}</div></>;
}

function Programs() {
  return <><Header eyebrow="Programas" title="Biblioteca clínica del cliente" detail="Programas por área con versión, medición, targets y aprobación visibles." action={<button className="primary-button"><Plus size={16} /> Crear programa</button>} /><section className="client-context"><span className="avatar">MR</span><div><small>Cliente seleccionado</small><strong>Mateo R. · MR-024</strong></div><button className="filter-button">Cambiar cliente <ChevronDown size={15} /></button></section><div className="program-card-grid">{programCards.map((program, index) => <article className="library-card" key={program[1]}><span className="card-number">0{index + 1}</span><div className="library-heading"><div><small>{program[0]}</small><h2>{program[1]}</h2></div><button className="icon-button"><ChevronRight size={17} /></button></div><div className="library-meta"><div><small>Medición</small><strong>{program[2]}</strong></div><div><small>Versión</small><strong>{program[4]} · vigente</strong></div><div><small>Target activo</small><strong>{program[3]}</strong></div><div><small>Progreso</small><strong>{program[5]}</strong></div></div><footer><Tag tone={program[6] === "Alto riesgo" ? "warn" : "good"}>{program[6]}</Tag><span><CheckCircle2 size={14} /> Configuración coherente</span></footer></article>)}</div></>;
}

function Monitoring() {
  return <><Header eyebrow="Monitoreo" title="Resultados que conservan su contexto" detail="Progreso, fidelidad e incidentes se muestran juntos para apoyar la revisión clínica." action={<button className="filter-button"><FileText size={16} /> Exportar revisión</button>} /><section className="panel monitor-panel"><div className="monitor-head"><div><small>Mateo R. · Comunicación funcional</small><h2>Mandos para pedir descanso</h2></div><div><button className="filter-button">30 días <ChevronDown size={14} /></button><button className="filter-button">% Independencia <ChevronDown size={14} /></button></div></div><div className="monitor-stats"><div><small>Último dato</small><strong>78%</strong><em>+16 puntos</em></div><div><small>Fidelidad</small><strong>96%</strong><em>Críticos: 100%</em></div><div><small>Sesiones</small><strong>12</strong><em>2 con IOA</em></div></div><div className="chart" role="img" aria-label="Tendencia ascendente de 52 a 78 por ciento"><span className="chart-y">100%<i />75%<i />50%<i />25%<i />0%</span><svg viewBox="0 0 800 250" preserveAspectRatio="none"><path className="grid" d="M0 8H800 M0 68H800 M0 128H800 M0 188H800 M0 248H800"/><path className="chart-area" d="M0 152 L114 141 L228 148 L342 116 L456 97 L570 82 L684 67 L800 50 L800 248 L0 248 Z"/><polyline points="0,152 114,141 228,148 342,116 456,97 570,82 684,67 800,50"/><line x1="400" y1="4" x2="400" y2="248"/><text x="408" y="24">Programa v3</text></svg><div className="chart-x"><span>7 jul</span><span>14 jul</span><span>21 jul</span><span>28 jul</span><span>6 ago</span></div></div></section><div className="analysis-grid"><section className="panel analysis-card"><div className="panel-heading"><div><p className="eyebrow">Lectura automatizada</p><h2>Descripción de los datos</h2></div><Tag tone="neutral">Cálculo fijo</Tag></div><p>El nivel aumentó de 52% a 78% durante ocho observaciones. La variabilidad reciente es baja y la fidelidad permaneció sobre el criterio. Esto describe los datos; la decisión clínica sigue pendiente de revisión.</p><div className="source-link"><CheckCircle2 size={15} /> Fuentes: 8 sesiones · Programa v3 · Fidelidad directa</div></section><section className="panel analysis-card"><div className="panel-heading"><div><p className="eyebrow">Preguntas clínicas</p><h2>Para revisar</h2></div><Sparkles size={17} /></div><ul><li>¿El aumento se mantiene con una segunda persona?</li><li>¿Hay oportunidades suficientes en contextos naturales?</li><li>¿Corresponde programar una sonda de generalización?</li></ul><div className="ai-note">Contenido generado por IA · requiere revisión humana</div></section></div></>;
}

function Quality() {
  return <><Header eyebrow="Calidad clínica" title="Fidelidad, riesgo y seguimiento" detail="Los componentes críticos no pueden compensarse con el porcentaje global ni reducirse por una muestra incompleta." action={<button className="primary-button"><ClipboardCheck size={16} /> Nueva observación</button>} /><section className="quality-metrics"><article><small>Fidelidad global</small><strong>93%</strong><em>criterio ≥90%</em></article><article><small>Componentes críticos</small><strong>100%</strong><em>sin fallos abiertos</em></article><article><small>Programas en alto riesgo</small><strong>2</strong><em>seguimiento semanal</em></article><article><small>Reevaluaciones pendientes</small><strong>1</strong><em>vence en 3 días</em></article></section><div className="quality-layout"><section className="panel quality-case"><div className="panel-heading"><div><p className="eyebrow">Caso priorizado</p><h2>Transiciones entre actividades</h2></div><Tag tone="warn">Alto riesgo</Tag></div><div className="case-person"><span className="avatar">MR</span><div><strong>Mateo R.</strong><small>Coordinador: L. Mendoza · Supervisor: A. Ruiz</small></div></div><div className="workflow"><div className="step done"><span><Check size={14}/></span><strong>Clasificación</strong><small>6 jul</small></div><i className="done"/><div className="step done"><span><Check size={14}/></span><strong>Estabilidad</strong><small>30 días</small></div><i/><div className="step current"><span>3</span><strong>Reclasificación</strong><small>Pendiente</small></div><i/><div className="step"><span>4</span><strong>Transición</strong><small>30 días</small></div></div><div className="evidence-list"><h3>Evidencia para reclasificación</h3><p><span><CheckCircle2 size={16}/> Datos bajo el umbral individual</span><Tag tone="good">Cumple</Tag></p><p><span><CheckCircle2 size={16}/> Incidentes y activaciones</span><Tag tone="good">Sin eventos</Tag></p><p><span><CheckCircle2 size={16}/> Fidelidad consecutiva</span><Tag tone="good">2 de 2</Tag></p><p><span><AlertTriangle size={16}/> Plan de seguridad actualizado</span><Tag tone="warn">Revisar</Tag></p></div><div className="approval"><ShieldCheck size={19}/><div><strong>Requiere autorización formal</strong><small>El coordinador propone; el supervisor verifica y autoriza.</small></div><button className="primary-button">Abrir revisión</button></div></section><aside className="quality-aside"><section className="panel"><div className="panel-heading"><div><p className="eyebrow">Regla institucional</p><h2>Criterio de fidelidad</h2></div></div><div className="fidelity"><div><strong>100%</strong><small>componentes críticos</small></div><span>+</span><div><strong>≥90%</strong><small>resultado global</small></div></div><p className="rule-copy">Un fallo crítico exige remediación aunque el porcentaje global alcance el criterio.</p></section><section className="panel transition-card"><div className="panel-heading"><div><p className="eyebrow">Transición</p><h2>Controles posteriores</h2></div></div><p><CalendarDays size={16}/><span><strong>Revisión semanal</strong><small>Durante al menos 30 días</small></span></p><p><ClipboardCheck size={16}/><span><strong>Fidelidad semanal</strong><small>100% críticos y ≥90% global</small></span></p><p><AlertTriangle size={16}/><span><strong>Retorno inmediato</strong><small>Incidente umbral o escalamiento grave</small></span></p></section></aside></div></>;
}
