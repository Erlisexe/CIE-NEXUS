"use client";
/* eslint-disable @next/next/no-img-element */

import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  BookOpenCheck,
  Building2,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  CircleHelp,
  Clock3,
  ClipboardCheck,
  FileCheck2,
  GraduationCap,
  LayoutDashboard,
  Layers3,
  LibraryBig,
  ListTree,
  LoaderCircle,
  LogOut,
  ImageIcon,
  KeyRound,
  Menu,
  Pencil,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Upload,
  UsersRound,
  UserCog,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import PackageManager from "./package-manager";
import GraphManager from "./graph-manager";
import InterventionSessionManager from "./intervention-session-manager";
import PersonnelProfileManager, { type LinkableAccount, type PersonnelProfile } from "./personnel-profile-manager";
import FormationManager from "./formation-manager";
import AccountManager from "./account-manager";
import PermissionManager from "./permission-manager";
import TeamProfileDirectory from "./team-profile-directory";
import ReportManager from "./report-manager";
import ProfilePhoto, { uploadProfilePhoto } from "./profile-photo";
import CalendarManager, { type CalendarAppointment } from "./calendar-manager";
import MeetingManager from "./meeting-manager";
import SiteManager, { type SiteRow } from "./site-manager";
import ABCManager, { ABCQuickCapture } from "./abc-manager";
import { canViewTeamProfiles, hasPermission, roleLabel, type AppAccount, type AppPermission } from "../../lib/access-control";
import { createSupabaseBrowserClient } from "../../lib/supabase/client";
import {
  areasForPackage,
  DEFAULT_EVALUATION_PACKAGE,
  normalizePackageDefinition,
  packageVersionLabel,
  targetsForPackage,
  type EvaluationArea,
  type EvaluationPackageDefinition,
  type EvaluationTarget,
} from "../../lib/evaluation-packages";

const DEFAULT_SITES = ["León", "Santo Domingo", "Las Colinas", "Estelí", "Masaya"];
const SOURCES = ["OD", "PD", "DR", "GR"] as const;
const NAV = [
  ["Inicio", LayoutDashboard],
  ["Calendario", CalendarDays],
  ["Reunión", CalendarClock],
  ["Niños", UsersRound],
  ["Portal de formación", CircleHelp],
  ["Formación", LibraryBig],
  ["Paquetes", Layers3],
  ["Equipo", UserRound],
  ["Cuentas", UserCog],
  ["Permisos", ShieldCheck],
  ["Sedes", Building2],
] as const;

type Status = "initial" | "teaching" | "reevaluation" | "complete";
type InterviewScore = "" | "1" | "0" | "SE";
type VerificationScore = "" | "1" | "0" | "SO";
type Screen = null | "initial" | "teaching" | "reevaluation" | "comparison";

type ItemScore = {
  interview: InterviewScore;
  verification: VerificationScore;
  source: string;
  missing: string;
};

type Scores = Record<string, ItemScore>;

type PlanPriority = {
  code: string;
  gapType: string;
  expectedBehavior: string;
  intervention: string;
  mastery: string;
  integrity: string;
  generalization: string;
  maintenance: string;
  reviewDate: string;
  bst: { instruction: boolean; modeling: boolean; rehearsal: boolean; feedback: boolean };
};

type TrainingCycle = {
  id: string;
  profileId: string | null;
  site: string;
  participantName: string;
  role: string;
  programContext: string;
  cycleLabel: string;
  instrumentVersion: string;
  packageTemplateId: string | null;
  instrumentSnapshot: EvaluationPackageDefinition;
  routeType: "4A" | "4B";
  status: Status;
  initialScores: Scores;
  teachingPlan: PlanPriority[];
  reevaluationScores: Scores;
  archivedAt: string | null;
  archiveSummary: { confirmed?: boolean; beforeStrength?: number; afterStrength?: number; netChange?: number };
  sourceCycleId: string | null;
  createdAt: string;
  updatedAt: string;
};

type HistoryEntry = {
  id: string;
  action: string;
  summary: string;
  details: string;
  createdAt: string;
};

type AppSettings = {
  pageName: string;
  institutionPhotoUrl: string | null;
  platformPhotoUrl: string | null;
  updatedAt?: string;
};

type DashboardProgram = {
  id: string;
  profileId: string | null;
  name: string;
  participantName: string;
  site: string;
  status: string;
  updatedAt: string;
  targets: Array<{ id: string; state: "baseline" | "acquisition" | "generalization" | "maintenance" | "closed" }>;
};

type DashboardSession = {
  id: string;
  programId: string;
  sessionDate: string;
  context: string;
  createdAt: string;
};

type Item = EvaluationTarget;
type Package = EvaluationArea;

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function normalizeCycle(raw: Record<string, unknown>): TrainingCycle {
  return {
    ...(raw as unknown as TrainingCycle),
    profileId: typeof raw.profileId === "string" ? raw.profileId : null,
    routeType: raw.routeType === "4B" ? "4B" : "4A",
    status: (["initial", "teaching", "reevaluation", "complete"].includes(String(raw.status)) ? raw.status : "initial") as Status,
    initialScores: parseJson<Scores>(raw.initialScores, {}),
    teachingPlan: parseJson<PlanPriority[]>(raw.teachingPlan, []),
    reevaluationScores: parseJson<Scores>(raw.reevaluationScores, {}),
    archivedAt: typeof raw.archivedAt === "string" ? raw.archivedAt : null,
    archiveSummary: parseJson<TrainingCycle["archiveSummary"]>(raw.archiveSummary, {}),
    sourceCycleId: typeof raw.sourceCycleId === "string" ? raw.sourceCycleId : null,
    packageTemplateId: typeof raw.packageTemplateId === "string" ? raw.packageTemplateId : null,
    instrumentSnapshot: normalizePackageDefinition(raw.instrumentSnapshot || DEFAULT_EVALUATION_PACKAGE),
  };
}

function blankScore(): ItemScore {
  return { interview: "", verification: "", source: "", missing: "" };
}

function targetMethods(item?: Item) {
  return item?.methods?.length ? item.methods : (["interview", "verification"] as const);
}

function scoreComplete(item: Item, score?: ItemScore) {
  const methods = targetMethods(item);
  return (!methods.includes("interview") || Boolean(score?.interview))
    && (!methods.includes("verification") || Boolean(score?.verification));
}

function classification(score?: ItemScore, item?: Item) {
  const methods = targetMethods(item);
  const interview = methods.includes("interview");
  const verification = methods.includes("verification");
  if ((interview && !score?.interview) || (verification && !score?.verification)) return { key: "incomplete", label: "Incompleto", tone: "neutral" };
  if ((interview && score?.interview === "SE" && !verification) || (verification && score?.verification === "SO")) return { key: "pending", label: "Evidencia pendiente", tone: "pending" };
  if (interview && verification) {
    if (score?.interview === "1" && score.verification === "1") return { key: "strength", label: "Fortaleza confirmada", tone: "good" };
    if (score?.interview === "1" && score.verification === "0") return { key: "execution", label: "Ejecución / sistema", tone: "warn" };
    if ((score?.interview === "0" || score?.interview === "SE") && score.verification === "1") return { key: "reasoning", label: "Razonamiento / documentación", tone: "blue" };
    return { key: "gap", label: "Brecha confirmada", tone: "danger" };
  }
  if ((interview && score?.interview === "1") || (verification && score?.verification === "1")) return { key: "strength", label: "Fortaleza confirmada", tone: "good" };
  return { key: "gap", label: "Brecha confirmada", tone: "danger" };
}

function gapType(score?: ItemScore, item?: Item) {
  const kind = classification(score, item).key;
  if (kind === "execution") return "Ejecución o sistema";
  if (kind === "reasoning") return score?.interview === "SE" ? "Documental" : "Conceptual o documental";
  return score?.interview === "SE" ? "Documental" : "Conceptual";
}

function statusLabel(status: Status) {
  return { initial: "Evaluación inicial", teaching: "En enseñanza", reevaluation: "Reevaluación abierta", complete: "Ciclo comparado" }[status];
}

function suggestedPriority(item: Item, score?: ItemScore): PlanPriority {
  const type = gapType(score, item);
  const intervention = type.includes("Ejecución")
    ? "Práctica en vivo, retroalimentación descriptiva y análisis de barreras"
    : type.includes("Documental")
      ? "Clarificación del protocolo, ejemplos/no ejemplos y ayuda de trabajo"
      : "BST: instrucción, modelado, ensayo y retroalimentación";
  return {
    code: item.code,
    gapType: type,
    expectedBehavior: `Demostrará ${item.title.toLowerCase()} con todos los componentes críticos, de forma independiente y trazable.`,
    intervention,
    mastery: "100% de componentes críticos y ≥90% de integridad global en dos observaciones consecutivas.",
    integrity: "100% de pasos críticos y ≥90% global durante la enseñanza.",
    generalization: "Demostración en un programa o contexto no utilizado durante la enseñanza.",
    maintenance: "Sondas a 2 y 4 semanas; retornar a práctica si el criterio deja de cumplirse.",
    reviewDate: "",
    bst: { instruction: false, modeling: false, rehearsal: false, feedback: false },
  };
}

function packageSummary(pack: Package, scores: Scores) {
  return pack.items.reduce((acc, item) => {
    const key = classification(scores[item.code], item).key;
    if (key === "strength") acc.strength += 1;
    else if (key === "pending" || key === "incomplete") acc.pending += 1;
    else acc.gaps += 1;
    return acc;
  }, { strength: 0, gaps: 0, pending: 0 });
}

function improvementSummary(cycle: TrainingCycle) {
  const packages = areasForPackage(cycle.instrumentSnapshot, cycle.routeType);
  const rows = packages.map((pack) => {
    const before = packageSummary(pack, cycle.initialScores).strength;
    const after = packageSummary(pack, cycle.reevaluationScores).strength;
    return { label: pack.short, before, after, change: after - before };
  });
  const before = rows.reduce((total, row) => total + row.before, 0);
  const after = rows.reduce((total, row) => total + row.after, 0);
  return { rows, before, after, net: after - before, improvedPackages: rows.filter((row) => row.change > 0).length };
}

function BrandImageCard({
  kind,
  title,
  description,
  imageUrl,
  uploading,
  onUpload,
}: {
  kind: "institution" | "platform";
  title: string;
  description: string;
  imageUrl: string | null;
  uploading: boolean;
  onUpload: (kind: "institution" | "platform", file?: File) => void;
}) {
  return <article className="formation-panel settings-card image-settings-card">
    <div className="settings-card-heading"><span>{imageUrl ? <img src={imageUrl} alt="" /> : <ImageIcon size={21}/>}</span><div><h2>{title}</h2><p>{description}</p></div></div>
    <div className="image-preview">{imageUrl ? <img src={imageUrl} alt={`Vista previa: ${title}`} /> : <><ImageIcon size={28}/><span>Sin imagen personalizada</span></>}</div>
    <label className="upload-button"><Upload size={16}/><span>{uploading ? "Subiendo…" : imageUrl ? "Reemplazar imagen" : "Subir imagen"}</span><input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading} onChange={(event) => { onUpload(kind, event.target.files?.[0]); event.currentTarget.value = ""; }} /></label>
    <small>PNG, JPG o WebP · máximo 2 MB</small>
  </article>;
}

export default function TrainingSystem({ account }: { account: AppAccount }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [active, setActive] = useState("Inicio");
  const [records, setRecords] = useState<TrainingCycle[]>([]);
  const [profiles, setProfiles] = useState<PersonnelProfile[]>([]);
  const [linkableAccounts, setLinkableAccounts] = useState<LinkableAccount[]>([]);
  const [evaluationPackages, setEvaluationPackages] = useState<EvaluationPackageDefinition[]>([DEFAULT_EVALUATION_PACKAGE]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TrainingCycle | null>(null);
  const [deleteText, setDeleteText] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<TrainingCycle | null>(null);
  const [improvementConfirmed, setImprovementConfirmed] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<TrainingCycle | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [settings, setSettings] = useState<AppSettings>({ pageName: "CIE Nexus", institutionPhotoUrl: null, platformPhotoUrl: null });
  const [sites, setSites] = useState<SiteRow[]>(DEFAULT_SITES.map((name) => ({ id: name, name, code: "", status: "active" })));
  const [pageNameDraft, setPageNameDraft] = useState("CIE Nexus");
  const [imageUploading, setImageUploading] = useState<"institution" | "platform" | null>(null);
  const [accountPhotoUrl, setAccountPhotoUrl] = useState<string | null>(null);
  const [accountPhotoUploading, setAccountPhotoUploading] = useState(false);
  const [passwordSending, setPasswordSending] = useState(false);
  const [appointmentToOpen, setAppointmentToOpen] = useState<CalendarAppointment | null>(null);
  const [sessionHistoryOnly, setSessionHistoryOnly] = useState(false);
  const [selectedGraphProgramId, setSelectedGraphProgramId] = useState<string | null>(null);
  const [abcQuickContext, setAbcQuickContext] = useState<{ profileId: string; profileName: string; programId?: string | null; sessionId?: string | null; appointmentId?: string | null } | null>(null);
  const consumeAppointment = useCallback(() => setAppointmentToOpen(null), []);
  const [dashboardPrograms, setDashboardPrograms] = useState<DashboardProgram[]>([]);
  const [dashboardSessions, setDashboardSessions] = useState<DashboardSession[]>([]);
  const [query, setQuery] = useState("");
  const [siteFilter, setSiteFilter] = useState("Todas");
  const [selectedSite, setSelectedSite] = useState("Todas");
  const [selectedProfileId, setSelectedProfileId] = useState("all");
  const [statusFilter, setStatusFilter] = useState("Todos");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>(null);
  const [packageIndex, setPackageIndex] = useState(0);
  const [form, setForm] = useState({ profileId: "", site: "León", participantName: "", role: "Niño", programContext: "", routeType: "4A" as "4A" | "4B", packageTemplateId: DEFAULT_EVALUATION_PACKAGE.id, sourceCycleId: null as string | null });

  const selected = useMemo(() => records.find((record) => record.id === selectedId) ?? null, [records, selectedId]);
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) ?? null;
  const scopedRecords = records.filter((record) => selectedProfileId !== "all"
    ? record.profileId === selectedProfileId
    : selectedSite === "Todas" || record.site === selectedSite);
  const activeRecords = scopedRecords.filter((record) => !record.archivedAt);
  const archivedRecords = scopedRecords.filter((record) => Boolean(record.archivedAt));
  const reevaluationCount = activeRecords.filter((record) => record.status === "reevaluation").length;
  const editingRecord = records.find((record) => record.id === editingId) ?? null;
  const activePackages = evaluationPackages.filter((pack) => pack.status === "active");
  const can = (permission: AppPermission) => hasPermission(account, permission);
  const canViewChildren = can("children.view");
  const canViewEvaluations = can("evaluations.view");
  const canViewPrograms = can("programs.view") || can("sessions.view") || can("sessions.record") || can("sessions.manage");
  const canManageChildren = can("children.manage");
  const canManageEvaluations = can("evaluations.manage");
  const canManagePrograms = can("programs.manage");
  const canRecordSessions = can("sessions.record") || can("sessions.manage");
  const canManageSessions = can("sessions.manage");
  const canManageGraphs = can("graphs.manage");
  const canManageReports = can("reports.manage");
  const canUseABC = can("abc.view") || can("abc.record") || can("abc.manage");
  const canRecordABC = can("abc.record") || can("abc.manage");
  const activeSiteNames = sites.filter((site) => site.status === "active").map((site) => site.name);
  const visibleNav = NAV.filter(([label]) => {
    const permissionByLabel: Record<string, AppPermission | null> = {
      Inicio: null,
      "Portal de formación": null,
      Formación: "training.manage",
      Niños: "children.view",
      Calendario: "calendar.view",
      Reunión: null,
      Paquetes: "packages.manage",
      Cuentas: "accounts.manage",
      Permisos: "permissions.manage",
      Sedes: "sites.view",
    };
    if (label === "Calendario") return can("calendar.view") || can("calendar.manage");
    if (label === "Sedes") return can("sites.view") || can("sites.manage");
    if (label === "Equipo") return canViewTeamProfiles(account.role);
    const permission = permissionByLabel[label];
    return permission === null || Boolean(permission && can(permission));
  });

  async function signOut() {
    await createSupabaseBrowserClient().auth.signOut();
    window.location.replace("/login");
  }

  async function refreshProfiles() {
    if (!can("children.view")) return;
    const response = await fetch("/api/personnel-profiles");
    const data = await response.json() as { profiles?: PersonnelProfile[]; linkableAccounts?: LinkableAccount[]; error?: string };
    if (!response.ok) throw new Error(data.error || "No se pudieron cargar los niños.");
    setProfiles(data.profiles || []);
    setLinkableAccounts(data.linkableAccounts || []);
  }

  function handleProfilesChange(nextProfiles: PersonnelProfile[]) {
    setProfiles(nextProfiles);
    setRecords((current) => current.map((record) => {
      const profile = nextProfiles.find((item) => item.id === record.profileId);
      return profile ? { ...record, participantName: profile.fullName, role: profile.role, site: profile.site } : record;
    }));
  }

  function chooseProfile(profileId: string) {
    setSelectedProfileId(profileId);
    const profile = profiles.find((item) => item.id === profileId);
    if (profile) setSelectedSite(profile.site);
    setSelectedId(null);
    setScreen(null);
  }

  useEffect(() => {
    Promise.all([
      canViewChildren ? fetch("/api/personnel-profiles").then(async (response) => {
        const data = await response.json() as { profiles?: PersonnelProfile[]; linkableAccounts?: LinkableAccount[]; error?: string };
        if (!response.ok) throw new Error(data.error || "No se pudieron cargar los niños.");
        setProfiles(data.profiles || []);
        setLinkableAccounts(data.linkableAccounts || []);
      }) : Promise.resolve(),
      canViewEvaluations ? fetch("/api/training-cycles").then(async (response) => {
        const data = await response.json() as { records?: Record<string, unknown>[]; error?: string };
        if (!response.ok) throw new Error(data.error || "No se pudieron cargar los ciclos.");
        setRecords((data.records || []).map(normalizeCycle));
      }) : Promise.resolve(),
    ]).catch((error: Error) => flash(error.message)).finally(() => setLoading(false));
  // Account permissions are immutable for the lifetime of this mounted session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!canViewEvaluations && !can("packages.manage")) return;
    fetch("/api/evaluation-packages")
      .then(async (response) => {
        const data = await response.json() as { packages?: EvaluationPackageDefinition[]; error?: string };
        if (!response.ok) throw new Error(data.error || "No se pudieron cargar los paquetes.");
        const normalized = (data.packages || []).map((pack) => normalizePackageDefinition(pack));
        setEvaluationPackages(normalized.length ? normalized : [DEFAULT_EVALUATION_PACKAGE]);
      })
      .catch((error: Error) => flash(error.message));
  // Account permissions are immutable for the lifetime of this mounted session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then(async (response) => {
        const data = await response.json() as { settings?: AppSettings; error?: string };
        if (!response.ok || !data.settings) throw new Error(data.error || "No se pudo cargar la personalización.");
        setSettings(data.settings);
        setPageNameDraft(data.settings.pageName);
      })
      .catch((error: Error) => flash(error.message));
  }, []);

  useEffect(() => {
    fetch("/api/sites", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as { sites?: SiteRow[]; error?: string };
        if (!response.ok) throw new Error(data.error || "No se pudieron cargar las sedes.");
        if (data.sites?.length) setSites(data.sites);
      })
      .catch((error: Error) => flash(error.message));
  }, []);

  useEffect(() => {
    document.title = settings.pageName;
  }, [settings.pageName]);

  useEffect(() => {
    fetch(`/api/profile-photos?subjectType=account&subjectId=${encodeURIComponent(account.id)}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json() as { photoUrl?: string | null; error?: string };
        if (!response.ok) throw new Error(data.error || "No se pudo cargar tu fotografía.");
        setAccountPhotoUrl(data.photoUrl || null);
      })
      .catch(() => undefined);
  }, [account.id]);

  useEffect(() => {
    if (active !== "Inicio" || screen || !canViewPrograms) return;
    fetch("/api/intervention-programs")
      .then(async (response) => {
        const data = await response.json() as { programs?: DashboardProgram[]; sessions?: DashboardSession[]; error?: string };
        if (!response.ok) throw new Error(data.error || "No se pudo actualizar el panorama.");
        setDashboardPrograms(data.programs || []);
        setDashboardSessions(data.sessions || []);
      })
      .catch((error: Error) => flash(error.message));
  // Account permissions are immutable for the lifetime of this mounted session.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, screen]);

  function flash(text: string) {
    const normalized = text.replace(/\s+/g, " ").trim();
    const safeMessage = /failed query|too many sql variables|too many variables|TEST-TARGET/i.test(normalized) || normalized.length > 280
      ? "No se pudo completar la carga. Intenta nuevamente."
      : normalized;
    setMessage(safeMessage);
    window.setTimeout(() => setMessage(""), 3200);
  }

  async function changeAccountPhoto(file: File) {
    setAccountPhotoUploading(true);
    try {
      const photoUrl = await uploadProfilePhoto("account", account.id, file);
      setAccountPhotoUrl(photoUrl);
      flash("Tu fotografía de perfil fue actualizada.");
    } catch (error) {
      flash(error instanceof Error ? error.message : "No se pudo guardar tu fotografía.");
    } finally { setAccountPhotoUploading(false); }
  }

  function updateLocal(next: TrainingCycle) {
    setRecords((current) => current.map((record) => record.id === next.id ? next : record));
  }

  async function persist(next: TrainingCycle, success = "Cambios guardados.") {
    setSaving(true);
    try {
      const response = await fetch("/api/training-cycles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const data = await response.json() as { record?: Record<string, unknown>; error?: string };
      if (!response.ok || !data.record) throw new Error(data.error || "No se pudo guardar.");
      const saved = normalizeCycle(data.record);
      updateLocal(saved);
      flash(success);
      return saved;
    } catch (error) {
      flash(error instanceof Error ? error.message : "No se pudo guardar.");
      return null;
    } finally { setSaving(false); }
  }

  async function createCycle() {
    if (!form.profileId || !form.programContext.trim()) {
      flash("Selecciona un niño y completa el programa/contexto.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch("/api/training-cycles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, cycleLabel: `Ciclo iniciado ${new Date().toLocaleDateString("es-NI")}` }),
      });
      const data = await response.json() as { record?: Record<string, unknown>; error?: string };
      if (!response.ok || !data.record) throw new Error(data.error || "No se pudo crear la evaluación.");
      const cycle = normalizeCycle(data.record);
      setRecords((current) => [cycle, ...current]);
      setSelectedProfileId(cycle.profileId || "all");
      setSelectedSite(cycle.site);
      setSelectedId(cycle.id);
      setPackageIndex(0);
      setScreen("initial");
      setNewOpen(false);
      setForm({ profileId: "", site: "León", participantName: "", role: "Niño", programContext: "", routeType: "4A", packageTemplateId: activePackages[0]?.id || DEFAULT_EVALUATION_PACKAGE.id, sourceCycleId: null });
      refreshProfiles().catch((error: Error) => flash(error.message));
    } catch (error) { flash(error instanceof Error ? error.message : "No se pudo crear la evaluación."); }
    finally { setSaving(false); }
  }

  function openCreate() {
    const profile = profiles.find((item) => item.id === selectedProfileId && item.status === "active") || profiles.find((item) => item.status === "active" && (selectedSite === "Todas" || item.site === selectedSite));
    if (!profile) { flash("Agrega primero un niño."); setActive("Niños"); return; }
    setEditingId(null);
    setForm({ profileId: profile.id, site: profile.site, participantName: profile.fullName, role: profile.role, programContext: "", routeType: "4A", packageTemplateId: activePackages[0]?.id || DEFAULT_EVALUATION_PACKAGE.id, sourceCycleId: null });
    setNewOpen(true);
  }

  function openNextPackage(record: TrainingCycle) {
    if (!record.archivedAt) return;
    setEditingId(null);
    setForm({
      profileId: record.profileId || "",
      site: record.site,
      participantName: record.participantName,
      role: record.role,
      programContext: record.programContext,
      routeType: record.routeType,
      packageTemplateId: activePackages.some((pack) => pack.id === record.packageTemplateId) ? String(record.packageTemplateId) : activePackages[0]?.id || DEFAULT_EVALUATION_PACKAGE.id,
      sourceCycleId: record.id,
    });
    setNewOpen(true);
  }

  function openEdit(record: TrainingCycle) {
    if (record.archivedAt) { flash("Los ciclos archivados son de solo lectura. Restáuralo para editarlo."); return; }
    setEditingId(record.id);
    setForm({ profileId: record.profileId || "", site: record.site, participantName: record.participantName, role: record.role, programContext: record.programContext, routeType: record.routeType, packageTemplateId: record.packageTemplateId || DEFAULT_EVALUATION_PACKAGE.id, sourceCycleId: null });
    setNewOpen(true);
  }

  async function saveMetadata() {
    if (!editingRecord) return createCycle();
    if (!form.profileId || !form.programContext.trim()) { flash("Selecciona un niño y completa el programa/contexto."); return; }
    const saved = await persist({ ...editingRecord, ...form }, "Datos de la evaluación actualizados.");
    if (saved) { setNewOpen(false); setEditingId(null); }
  }

  async function deleteCycle() {
    if (!deleteTarget || deleteText.trim().toUpperCase() !== "ELIMINAR") return;
    setSaving(true);
    try {
      const response = await fetch("/api/training-cycles", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: deleteTarget.id }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo eliminar.");
      setRecords((current) => current.filter((record) => record.id !== deleteTarget.id));
      refreshProfiles().catch((error: Error) => flash(error.message));
      if (selectedId === deleteTarget.id) { setSelectedId(null); setScreen(null); }
      setDeleteTarget(null); setDeleteText(""); flash("Evaluación e historial eliminados permanentemente.");
    } catch (error) { flash(error instanceof Error ? error.message : "No se pudo eliminar."); }
    finally { setSaving(false); }
  }

  async function openHistory(record: TrainingCycle) {
    setHistoryTarget(record);
    setHistory([]);
    setHistoryLoading(true);
    try {
      const response = await fetch(`/api/training-cycles?historyFor=${encodeURIComponent(record.id)}`);
      const data = await response.json() as { history?: HistoryEntry[]; error?: string };
      if (!response.ok) throw new Error(data.error || "No se pudo cargar el historial.");
      setHistory(data.history || []);
    } catch (error) { flash(error instanceof Error ? error.message : "No se pudo cargar el historial."); }
    finally { setHistoryLoading(false); }
  }

  async function archiveCycle() {
    if (!archiveTarget || !improvementConfirmed) return;
    setSaving(true);
    try {
      const response = await fetch("/api/training-cycles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: archiveTarget.id, action: "archive", improvementConfirmed: true }),
      });
      const data = await response.json() as { record?: Record<string, unknown>; error?: string };
      if (!response.ok || !data.record) throw new Error(data.error || "No se pudo archivar el ciclo.");
      const saved = normalizeCycle(data.record);
      updateLocal(saved);
      setArchiveTarget(null);
      setImprovementConfirmed(false);
      setSelectedId(null);
      setScreen(null);
      setActive("Archivo");
      flash("Ciclo archivado. Ya puedes iniciar un nuevo paquete desde su registro.");
    } catch (error) { flash(error instanceof Error ? error.message : "No se pudo archivar el ciclo."); }
    finally { setSaving(false); }
  }

  async function restoreCycle(record: TrainingCycle) {
    setSaving(true);
    try {
      const response = await fetch("/api/training-cycles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: record.id, action: "restore" }),
      });
      const data = await response.json() as { record?: Record<string, unknown>; error?: string };
      if (!response.ok || !data.record) throw new Error(data.error || "No se pudo restaurar el ciclo.");
      updateLocal(normalizeCycle(data.record));
      flash("Ciclo restaurado al listado activo.");
    } catch (error) { flash(error instanceof Error ? error.message : "No se pudo restaurar el ciclo."); }
    finally { setSaving(false); }
  }

  async function saveSettings() {
    setSaving(true);
    try {
      const response = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pageName: pageNameDraft }) });
      const data = await response.json() as { settings?: AppSettings; error?: string };
      if (!response.ok || !data.settings) throw new Error(data.error || "No se pudo guardar el nombre.");
      setSettings(data.settings);
      setPageNameDraft(data.settings.pageName);
      flash("Nombre de la página actualizado.");
    } catch (error) { flash(error instanceof Error ? error.message : "No se pudo guardar el nombre."); }
    finally { setSaving(false); }
  }

  async function uploadBrandImage(kind: "institution" | "platform", file?: File) {
    if (!file) return;
    setImageUploading(kind);
    try {
      const body = new FormData();
      body.append("kind", kind);
      body.append("file", file);
      const response = await fetch("/api/settings", { method: "POST", body });
      const data = await response.json() as { settings?: AppSettings; error?: string };
      if (!response.ok || !data.settings) throw new Error(data.error || "No se pudo subir la imagen.");
      setSettings(data.settings);
      flash(kind === "institution" ? "Foto de la institución actualizada." : "Imagen de la plataforma actualizada.");
    } catch (error) { flash(error instanceof Error ? error.message : "No se pudo subir la imagen."); }
    finally { setImageUploading(null); }
  }

  async function requestPasswordChange() {
    setPasswordSending(true);
    try {
      const redirectTo = `${window.location.origin}/auth/callback?next=/actualizar-contrasena`;
      const { error } = await createSupabaseBrowserClient().auth.resetPasswordForEmail(account.email, { redirectTo });
      if (error) throw error;
      flash(`Enviamos un enlace de verificación a ${account.email}.`);
    } catch {
      flash("No se pudo enviar el correo de verificación. Intenta nuevamente.");
    } finally { setPasswordSending(false); }
  }

  function openRecord(record: TrainingCycle, preferred?: Screen) {
    const destination = preferred || (record.status === "initial" ? "initial" : record.status === "teaching" ? "teaching" : record.status === "reevaluation" ? "reevaluation" : "comparison");
    setSelectedId(record.id);
    setPackageIndex(0);
    setScreen(destination);
  }

  function setScore(moment: "initial" | "reevaluation", code: string, patch: Partial<ItemScore>) {
    if (!selected) return;
    const key = moment === "initial" ? "initialScores" : "reevaluationScores";
    const scoreSet = selected[key];
    updateLocal({ ...selected, [key]: { ...scoreSet, [code]: { ...(scoreSet[code] || blankScore()), ...patch } } });
  }

  function buildInitialPlan(cycle: TrainingCycle) {
    return targetsForPackage(cycle.instrumentSnapshot, cycle.routeType)
      .filter((item) => !["strength", "pending", "incomplete"].includes(classification(cycle.initialScores[item.code], item).key))
      .sort((a, b) => Number(Boolean(b.alert)) - Number(Boolean(a.alert)))
      .slice(0, 3)
      .map((item) => suggestedPriority(item, cycle.initialScores[item.code]));
  }

  async function finishInitial() {
    if (!selected) return;
    const targets = targetsForPackage(selected.instrumentSnapshot, selected.routeType);
    const allScored = targets.every((item) => scoreComplete(item, selected.initialScores[item.code]));
    if (!allScored) { flash(`Completa los ${targets.length} targets y sus métodos requeridos; SE y SO cuentan como registro válido.`); return; }
    const plan = buildInitialPlan(selected);
    const next = { ...selected, teachingPlan: plan, status: (plan.length ? "teaching" : "reevaluation") as Status };
    const saved = await persist(next, plan.length ? "Evaluación cerrada; plan de enseñanza generado." : "Evaluación cerrada; no se detectaron brechas para enseñar.");
    if (saved) setScreen(plan.length ? "teaching" : "reevaluation");
  }

  function updatePriority(index: number, patch: Partial<PlanPriority>) {
    if (!selected) return;
    const plan = selected.teachingPlan.map((priority, i) => i === index ? { ...priority, ...patch } : priority);
    updateLocal({ ...selected, teachingPlan: plan });
  }

  function toggleBst(index: number, step: keyof PlanPriority["bst"]) {
    if (!selected) return;
    const priority = selected.teachingPlan[index];
    updatePriority(index, { bst: { ...priority.bst, [step]: !priority.bst[step] } });
  }

  function removePriority(index: number) {
    if (!selected) return;
    updateLocal({ ...selected, teachingPlan: selected.teachingPlan.filter((_, i) => i !== index) });
  }

  function addPriority(item: Item) {
    if (!selected || selected.teachingPlan.length >= 3 || selected.teachingPlan.some((p) => p.code === item.code)) return;
    updateLocal({ ...selected, teachingPlan: [...selected.teachingPlan, suggestedPriority(item, selected.initialScores[item.code])] });
  }

  async function openReevaluation() {
    if (!selected) return;
    const ready = selected.teachingPlan.every((priority) => Object.values(priority.bst).every(Boolean) && priority.mastery.trim() && priority.generalization.trim());
    if (!ready) { flash("Completa las cuatro fases de enseñanza y los criterios de dominio y generalización."); return; }
    const next = { ...selected, status: "reevaluation" as Status };
    const saved = await persist(next, "Reevaluación abierta con la misma versión del instrumento.");
    if (saved) { setPackageIndex(0); setScreen("reevaluation"); }
  }

  async function finishReevaluation() {
    if (!selected) return;
    const targets = targetsForPackage(selected.instrumentSnapshot, selected.routeType);
    const allScored = targets.every((item) => scoreComplete(item, selected.reevaluationScores[item.code]));
    if (!allScored) { flash(`Completa los ${targets.length} targets de la reevaluación antes de comparar.`); return; }
    const saved = await persist({ ...selected, status: "complete" }, "Reevaluación cerrada; comparación disponible.");
    if (saved) setScreen("comparison");
  }

  function renderOverview() {
    const scopedPrograms = dashboardPrograms.filter((program) => program.status === "active" && (selectedProfileId !== "all" ? program.profileId === selectedProfileId : selectedSite === "Todas" || program.site === selectedSite));
    const scopedProgramIds = new Set(scopedPrograms.map((program) => program.id));
    const scopedSessions = dashboardSessions.filter((session) => scopedProgramIds.has(session.programId));
    const openTargets = scopedPrograms.flatMap((program) => program.targets).filter((target) => target.state !== "closed").length;
    const activeChildren = profiles.filter((profile) => profile.status === "active" && (selectedSite === "Todas" || profile.site === selectedSite));
    const activeSites = activeSiteNames.length;
    const evaluationTasks = canManageEvaluations ? [
      ...activeRecords.filter((record) => record.status === "reevaluation").map((record) => ({ id: `re-${record.id}`, tone: "violet", label: "Cerrar reevaluación", detail: `${record.participantName} · ${record.programContext}`, action: () => openRecord(record, "reevaluation") })),
      ...activeRecords.filter((record) => record.status === "teaching").map((record) => ({ id: `te-${record.id}`, tone: "amber", label: "Completar enseñanza", detail: `${record.participantName} · ${record.programContext}`, action: () => openRecord(record, "teaching") })),
      ...activeRecords.filter((record) => record.status === "initial").map((record) => ({ id: `in-${record.id}`, tone: "blue", label: "Completar evaluación", detail: `${record.participantName} · ${record.programContext}`, action: () => openRecord(record, "initial") })),
    ] : [];
    const tasks = evaluationTasks.slice(0, 6);
    const recentActivity = [
      ...activeRecords.map((record) => ({ id: `cycle-${record.id}`, date: record.updatedAt, icon: ClipboardCheck, title: statusLabel(record.status), detail: `${record.participantName} · ${record.programContext}` })),
      ...scopedSessions.map((session) => { const program = scopedPrograms.find((item) => item.id === session.programId); return { id: `session-${session.id}`, date: session.createdAt || session.sessionDate, icon: Clock3, title: "Sesión cerrada", detail: `${program?.participantName || "Niño"} · ${program?.name || session.context}` }; }),
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 5);
    const contextName = selectedProfile ? selectedProfile.fullName : selectedSite !== "Todas" ? `Sede ${selectedSite}` : "Vista institucional";
    const contextDetail = selectedProfile ? `Niño · ${selectedProfile.site}` : selectedSite !== "Todas" ? `${profiles.filter((profile) => profile.site === selectedSite && profile.status === "active").length} niños activos` : activeSiteNames.join(" · ") || "Sin sedes activas";
    const contextInitials = selectedProfile ? selectedProfile.fullName.split(" ").map((part) => part[0]).join("").slice(0, 2).toUpperCase() : "CIE";
    const now = new Date();
    const greeting = now.getHours() < 12 ? "Buenos días" : now.getHours() < 18 ? "Buenas tardes" : "Buenas noches";
    const dayLabel = now.toLocaleDateString("es-NI", { weekday: "long", day: "numeric", month: "long" });
    return <div className="cie-dashboard">
      <section className="cie-dashboard-welcome">
        <div><p className="section-kicker">Panel clínico institucional</p><h1>{greeting}, {account.displayName.split(" ")[0]}</h1><p>{dayLabel.charAt(0).toUpperCase() + dayLabel.slice(1)} · seguimiento operativo de CIE Nexus</p></div>
        <div className="cie-current-context"><span>{selectedProfile ? contextInitials : settings.institutionPhotoUrl ? <img src={settings.institutionPhotoUrl} alt=""/> : contextInitials}</span><div><small>Vista actual</small><strong>{contextName}</strong><p>{contextDetail}</p></div></div>
      </section>

      <section className="cie-stat-grid" aria-label="Indicadores principales">
        <article className="blue"><span><UsersRound size={23}/></span><div><small>Niños activos</small><strong>{activeChildren.length}</strong><p>Expedientes visibles</p></div></article>
        <article className="yellow"><span><BookOpenCheck size={23}/></span><div><small>Programas</small><strong>{scopedPrograms.length}</strong><p>En intervención</p></div></article>
        <article className="red"><span><Clock3 size={23}/></span><div><small>Sesiones</small><strong>{scopedSessions.length}</strong><p>En la selección</p></div></article>
        <article className="blue-soft"><span><Target size={23}/></span><div><small>Targets abiertos</small><strong>{openTargets}</strong><p>Pendientes de cierre</p></div></article>
        <article className="yellow-soft"><span><ClipboardCheck size={23}/></span><div><small>Evaluaciones</small><strong>{activeRecords.length}</strong><p>{reevaluationCount} en reevaluación</p></div></article>
        <article className="red-soft"><span><Building2 size={23}/></span><div><small>Sedes activas</small><strong>{activeSites}</strong><p>Directorio institucional</p></div></article>
      </section>

      <div className="cie-dashboard-columns">
        <section className="formation-panel cie-access-panel">
          <div className="panel-title"><div><p className="section-kicker">Accesos</p><h2>Herramientas clínicas</h2></div><LayoutDashboard size={18}/></div>
          <div className="cie-access-grid">
            {canViewChildren && <button onClick={() => setActive("Niños")}><span className="blue"><UsersRound size={20}/></span><div><strong>Niños</strong><small>Abrir expedientes</small></div><ChevronRight size={16}/></button>}
            {(can("calendar.view") || can("calendar.manage")) && <button onClick={() => setActive("Calendario")}><span className="yellow"><CalendarDays size={20}/></span><div><strong>Calendario</strong><small>Ver agenda clínica</small></div><ChevronRight size={16}/></button>}
            <button onClick={() => window.location.assign("/formacion")}><span className="blue"><CircleHelp size={20}/></span><div><strong>CIE Nexus Formación</strong><small>Abrir portal formativo</small></div><ChevronRight size={16}/></button>
            {canViewTeamProfiles(account.role) && <button onClick={() => setActive("Equipo")}><span className="red"><UserRound size={20}/></span><div><strong>Equipo</strong><small>Perfiles profesionales</small></div><ChevronRight size={16}/></button>}
          </div>
        </section>

        <section className="formation-panel dashboard-tasks"><div className="panel-title"><div><p className="section-kicker">Prioridades</p><h2>Próximas tareas</h2></div><span>{tasks.length}</span></div>{tasks.length ? <div className="task-list">{tasks.map((task) => <button key={task.id} onClick={task.action}><i className={task.tone}/><div><strong>{task.label}</strong><small>{task.detail}</small></div><ChevronRight size={17}/></button>)}</div> : <div className="empty-state dashboard-empty"><CheckCircle2 size={28}/><strong>Sin tareas pendientes</strong></div>}</section>

        <section className="formation-panel dashboard-activity"><div className="panel-title"><div><p className="section-kicker">Actividad</p><h2>Movimientos recientes</h2></div><Clock3 size={18}/></div>{recentActivity.length ? <div className="activity-list">{recentActivity.map((item) => { const Icon = item.icon; return <article key={item.id}><span><Icon size={16}/></span><div><strong>{item.title}</strong><small>{item.detail}</small></div><time>{new Date(item.date).toLocaleDateString("es-NI", { day: "2-digit", month: "short" })}</time></article>; })}</div> : <div className="empty-state dashboard-empty"><CircleDashed size={27}/><strong>Sin actividad reciente</strong></div>}</section>
      </div>

      {(can("calendar.view") || can("calendar.manage")) && <CalendarManager
        compact
        profiles={profiles}
        notify={flash}
        onOpenSession={(appointment: CalendarAppointment) => {
          chooseProfile(appointment.profileId);
          setAppointmentToOpen(appointment);
          setSessionHistoryOnly(false);
          setActive("Sesiones");
        }}
      />}
    </div>;
  }

  function listConfig() {
    if (active === "Enseñanza") return { title: "Procedimientos de enseñanza", intro: "Las brechas se convierten en conductas observables, práctica y criterios de dominio.", records: activeRecords.filter((r) => r.status === "teaching"), empty: "No hay planes de enseñanza activos." };
    if (active === "Reevaluaciones") return { title: "Reevaluaciones", intro: "La segunda medición utiliza el mismo instrumento, versión, ruta y unidad de análisis.", records: activeRecords.filter((r) => r.status === "reevaluation" || r.status === "complete"), empty: "Aún no hay reevaluaciones abiertas." };
    if (active === "Comparación") return { title: "Comparación de ciclos", intro: "Resultados por paquete y sede, sin promediar áreas distintas ni producir rankings.", records: activeRecords.filter((r) => r.status === "complete"), empty: "La comparación aparecerá cuando cierre la primera reevaluación." };
    if (active === "Archivo") return { title: "Archivo de ciclos", intro: "Ciclos cerrados después de confirmar una mejora. Permanecen intactos y disponibles para iniciar un nuevo paquete.", records: archivedRecords, empty: "Todavía no hay ciclos archivados." };
    return { title: "Evaluaciones clínicas", intro: "Entrevista y verificación se puntúan por separado antes de construir el plan.", records: activeRecords, empty: "No hay evaluaciones activas." };
  }

  function renderList() {
    const config = listConfig();
    const normalizedQuery = query.trim().toLocaleLowerCase("es");
    const visibleRecords = config.records.filter((record) => {
      const matchesText = !normalizedQuery || [record.participantName, record.site, record.programContext, record.cycleLabel].some((value) => value.toLocaleLowerCase("es").includes(normalizedQuery));
      const matchesSite = siteFilter === "Todas" || record.site === siteFilter;
      const matchesStatus = statusFilter === "Todos" || record.status === statusFilter;
      return matchesText && matchesSite && matchesStatus;
    });
    return <>
      <div className="formation-heading"><div><p className="section-kicker">{active === "Archivo" ? "Conservación longitudinal" : "Ciclo formativo activo"}</p><h1>{config.title}</h1><p>{config.intro}</p></div>{active === "Evaluaciones" && canManageEvaluations && <button className="primary-formation-button" onClick={openCreate}><Plus size={17} /> Nueva evaluación</button>}</div>
      <section className="protocol-strip"><span><ShieldAlert size={20} /></span><div><strong>Evaluar no es entrenar</strong><p>Durante la muestra se puntúa sin coaching. La retroalimentación empieza después de cerrar la evaluación.</p></div><em>{activePackages.length} paquete{activePackages.length === 1 ? " activo" : "s activos"}</em></section>
      <section className="record-tools" aria-label="Filtros de evaluaciones">
        <label><span className="sr-only">Buscar evaluaciones</span><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar participante, sede o programa" /></label>
        <select aria-label="Filtrar por sede" value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)}><option>Todas</option>{activeSiteNames.map((site) => <option key={site}>{site}</option>)}</select>
        <select aria-label="Filtrar por estado" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="Todos">Todos los estados</option><option value="initial">Evaluación inicial</option><option value="teaching">En enseñanza</option><option value="reevaluation">Reevaluación abierta</option><option value="complete">Ciclo comparado</option></select>
        <span aria-live="polite">{visibleRecords.length} resultado{visibleRecords.length === 1 ? "" : "s"}</span>
      </section>
      <section className="formation-panel records-panel">
        <div className="record-head"><span>Participante y sede</span><span>Programa / ruta</span><span>Estado</span><span>Actualización</span><span>Acciones</span></div>
        {loading ? <div className="empty-state"><LoaderCircle className="spin" size={24} /><strong>Cargando ciclos…</strong></div> : visibleRecords.length ? visibleRecords.map((record) => (
          <div className="record-row" key={record.id}>
            <div className="record-person"><span>{record.participantName.split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase()}</span><div><strong>{record.participantName}</strong><small>Sede {record.site} · {record.role}</small></div></div>
            <div><strong>{record.programContext}</strong><small>Ruta {record.routeType} · {record.instrumentVersion}</small></div>
            <span className={`record-status ${record.archivedAt ? "status-archived" : `status-${record.status}`}`}>{record.archivedAt ? "Archivado" : statusLabel(record.status)}</span>
            <div><strong>{new Date(record.updatedAt).toLocaleDateString("es-NI", { day: "2-digit", month: "short" })}</strong><small>{record.cycleLabel}</small></div>
            <div className="record-actions">
              <button aria-label={`Ver historial de ${record.participantName}`} title="Historial" onClick={() => openHistory(record)}><Clock3 size={15} /></button>
              {record.archivedAt ? <>
                <button aria-label={`Crear nuevo paquete para ${record.participantName}`} title="Nuevo paquete" onClick={() => openNextPackage(record)}><Plus size={15} /></button>
                <button aria-label={`Restaurar ciclo de ${record.participantName}`} title="Restaurar" onClick={() => restoreCycle(record)}><RotateCcw size={15} /></button>
              </> : <button aria-label={`Editar evaluación de ${record.participantName}`} title="Editar" onClick={() => openEdit(record)}><Pencil size={15} /></button>}
              <button className="danger-action" aria-label={`Eliminar evaluación de ${record.participantName}`} title="Eliminar" onClick={() => { setDeleteTarget(record); setDeleteText(""); }}><Trash2 size={15} /></button>
              <button className="open-record" onClick={() => openRecord(record, record.archivedAt ? "comparison" : active === "Enseñanza" ? "teaching" : active === "Reevaluaciones" ? (record.status === "complete" ? "comparison" : "reevaluation") : active === "Comparación" ? "comparison" : undefined)}>Abrir <ChevronRight size={15} /></button>
            </div>
          </div>
        )) : <div className="empty-state"><CircleDashed size={27} /><strong>{config.empty}</strong><p>{active === "Evaluaciones" ? "Inicia con una persona de cualquiera de las cinco sedes." : active === "Archivo" ? "Un ciclo aparecerá aquí cuando termine la reevaluación y confirmes una mejora." : "El sistema la habilitará al completar la etapa anterior."}</p></div>}
      </section>
    </>;
  }

  function renderEvaluation(moment: "initial" | "reevaluation") {
    if (!selected) return null;
    const packs = areasForPackage(selected.instrumentSnapshot, selected.routeType);
    const pack = packs[packageIndex];
    const scores = moment === "initial" ? selected.initialScores : selected.reevaluationScores;
    const targets = targetsForPackage(selected.instrumentSnapshot, selected.routeType);
    const completed = targets.filter((item) => scoreComplete(item, scores[item.code])).length;
    const alerts = targets.filter((item) => item.alert && ["execution", "reasoning", "gap"].includes(classification(scores[item.code], item).key)).length;
    if (!pack) return <section className="empty-state"><AlertTriangle size={28}/><strong>El paquete no contiene áreas aplicables a esta ruta.</strong><p>Crea una nueva versión del paquete y revisa la aplicación de sus áreas.</p></section>;
    return <>
      <div className="work-header"><button className="back-button" onClick={() => setScreen(null)}><ArrowLeft size={17} /> Volver</button><div><p className="section-kicker">{moment === "initial" ? "Evaluación inicial" : "Reevaluación comparable"}</p><h1>{selected.participantName}</h1><p>Sede {selected.site} · {selected.programContext} · Ruta {selected.routeType}</p></div><div className="header-actions"><button className="secondary-formation-button" onClick={() => openHistory(selected)}><Clock3 size={15}/> Historial</button><button className="secondary-formation-button" onClick={() => openEdit(selected)}><Pencil size={15}/> Editar datos</button><div className="version-lock"><FileCheck2 size={17} /><span>Instrumento bloqueado</span><strong>{selected.instrumentVersion}</strong></div></div></div>
      <section className="instrument-objective"><Layers3 size={20}/><div><strong>{selected.instrumentSnapshot.name}</strong><p>{selected.instrumentSnapshot.objective}</p></div></section>
      <section className="evaluation-progress"><div role="progressbar" aria-label="Progreso de evaluación" aria-valuemin={0} aria-valuemax={targets.length} aria-valuenow={completed}><span style={{ width: `${targets.length ? (completed / targets.length) * 100 : 0}%` }} /></div><strong>{completed}/{targets.length} targets completos</strong>{alerts > 0 && <em><AlertTriangle size={14} /> {alerts} alerta{alerts === 1 ? "" : "s"} por revisar</em>}</section>
      {moment === "reevaluation" && <section className="comparison-rule"><RefreshCcw size={19} /><p><strong>No se sobrescribe la línea base.</strong> Esta medición queda separada y utiliza los mismos {targets.length} targets, ruta y versión.</p></section>}
      <div className="package-tabs" role="tablist" aria-label="Áreas de evaluación">{packs.map((p, index) => <button role="tab" aria-selected={packageIndex === index} className={packageIndex === index ? "active" : ""} key={p.key} onClick={() => setPackageIndex(index)}><span>{p.label}</span><strong>{p.short}</strong><em>{p.items.filter((item) => scoreComplete(item, scores[item.code])).length}/{p.items.length}</em></button>)}</div>
      <section className="assessment-panel">
        <div className="assessment-title"><div><p className="section-kicker">{pack.label}</p><h2>{pack.short}</h2>{pack.description && <p>{pack.description}</p>}</div><span>1 solo si demuestra todos los componentes críticos</span></div>
        {pack.items.map((item) => {
          const score = scores[item.code] || blankScore();
          const methods = targetMethods(item);
          const state = classification(score, item);
          const baseline = moment === "reevaluation" ? classification(selected.initialScores[item.code], item) : null;
          return <article className={`assessment-item methods-${methods.length} ${item.alert ? "critical" : ""}`} key={item.code}>
            <div className="item-copy"><div><span className="item-code">{item.code}</span>{item.alert && <span className="alert-code"><AlertTriangle size={12} /> Componente sensible</span>}</div><h3>{item.title}</h3><p>{item.criterion}</p>{baseline && <div className={`baseline-pill tone-${baseline.tone}`}>Línea base: {baseline.label}</div>}</div>
            {methods.includes("interview") && <div className="score-column"><label>Entrevista</label><div className="score-options">{(["1", "0", "SE"] as InterviewScore[]).map((value) => <button aria-pressed={score.interview === value} aria-label={`${item.code}, entrevista: ${value}`} className={score.interview === value ? "selected" : ""} key={value} onClick={() => setScore(moment, item.code, { interview: value })}>{value}</button>)}</div><small>1 / 0 / sin evidencia</small></div>}
            {methods.includes("verification") && <div className="score-column"><label>Verificación</label><div className="score-options">{(["1", "0", "SO"] as VerificationScore[]).map((value) => <button aria-pressed={score.verification === value} aria-label={`${item.code}, verificación: ${value}`} className={score.verification === value ? "selected" : ""} key={value} onClick={() => setScore(moment, item.code, { verification: value })}>{value}</button>)}</div><small>1 / 0 / sin oportunidad</small></div>}
            <div className="evidence-column"><label>Fuente principal</label><select value={score.source} onChange={(event) => setScore(moment, item.code, { source: event.target.value })}><option value="">Seleccionar</option>{SOURCES.map((source) => <option value={source} key={source}>{source}</option>)}</select><input value={score.missing} onChange={(event) => setScore(moment, item.code, { missing: event.target.value })} placeholder="Componente faltante o nota breve" aria-label={`Componente faltante ${item.code}`} /></div>
            <span className={`integrated-state tone-${state.tone}`}>{state.label}</span>
          </article>;
        })}
      </section>
      <div className="sticky-actions"><div><strong>{pack.short}</strong><small>Las puntuaciones se guardan sin sustituir la evidencia original.</small></div><button className="secondary-formation-button" onClick={() => persist(selected)} disabled={saving}><Save size={16} /> Guardar borrador</button>{packageIndex < packs.length - 1 ? <button className="primary-formation-button" onClick={() => setPackageIndex(packageIndex + 1)}>Siguiente área <ArrowRight size={16} /></button> : <button className="primary-formation-button" onClick={moment === "initial" ? finishInitial : finishReevaluation}>{moment === "initial" ? "Cerrar evaluación" : "Cerrar reevaluación"} <Check size={16} /></button>}</div>
    </>;
  }

  function renderTeaching() {
    if (!selected) return null;
    const cycleTargets = targetsForPackage(selected.instrumentSnapshot, selected.routeType);
    const gaps = cycleTargets.filter((item) => !["strength", "pending", "incomplete"].includes(classification(selected.initialScores[item.code], item).key));
    const ready = selected.teachingPlan.length > 0 && selected.teachingPlan.every((priority) => Object.values(priority.bst).every(Boolean) && priority.mastery.trim() && priority.generalization.trim());
    return <>
      <div className="work-header"><button className="back-button" onClick={() => setScreen(null)}><ArrowLeft size={17} /> Volver</button><div><p className="section-kicker">Plan de enseñanza</p><h1>{selected.participantName}</h1><p>Sede {selected.site} · máximo tres prioridades iniciales</p></div><div className="header-actions"><button className="secondary-formation-button" onClick={() => openHistory(selected)}><Clock3 size={15}/> Historial</button><div className="version-lock"><GraduationCap size={17} /><span>Basado en</span><strong>Brechas confirmadas</strong></div></div></div>
      <section className="teaching-principle"><Sparkles size={20} /><div><strong>Asistencia no equivale a dominio</strong><p>El criterio de salida es una conducta profesional independiente, precisa, generalizada y mantenida.</p></div></section>
      {selected.teachingPlan.map((priority, index) => {
        const item = cycleTargets.find((candidate) => candidate.code === priority.code)!;
        return <section className="priority-card" key={priority.code}>
          <div className="priority-heading"><span>Prioridad {index + 1}</span><div><strong>{priority.code} · {item.title}</strong><small>{priority.gapType}</small></div><button aria-label={`Eliminar ${priority.code}`} onClick={() => removePriority(index)}><Trash2 size={16} /></button></div>
          <div className="plan-fields"><label className="field-wide"><span>Conducta esperada</span><textarea value={priority.expectedBehavior} onChange={(event) => updatePriority(index, { expectedBehavior: event.target.value })} /></label><label><span>Intervención</span><textarea value={priority.intervention} onChange={(event) => updatePriority(index, { intervention: event.target.value })} /></label><label><span>Criterio de dominio</span><textarea value={priority.mastery} onChange={(event) => updatePriority(index, { mastery: event.target.value })} /></label><label><span>Integridad de enseñanza</span><textarea value={priority.integrity} onChange={(event) => updatePriority(index, { integrity: event.target.value })} /></label><label><span>Generalización</span><textarea value={priority.generalization} onChange={(event) => updatePriority(index, { generalization: event.target.value })} /></label><label><span>Mantenimiento y retorno</span><textarea value={priority.maintenance} onChange={(event) => updatePriority(index, { maintenance: event.target.value })} /></label><label><span>Fecha de revisión</span><input type="date" value={priority.reviewDate} onChange={(event) => updatePriority(index, { reviewDate: event.target.value })} /></label></div>
          <div className="bst-flow"><p><span>BST</span> Procedimiento de enseñanza</p>{(["instruction", "modeling", "rehearsal", "feedback"] as const).map((step, stepIndex) => { const labels = ["Instrucción", "Modelado", "Ensayo", "Retroalimentación"]; return <button className={priority.bst[step] ? "done" : ""} key={step} onClick={() => toggleBst(index, step)}><span>{priority.bst[step] ? <Check size={15} /> : stepIndex + 1}</span><strong>{labels[stepIndex]}</strong><small>{priority.bst[step] ? "Documentado" : "Pendiente"}</small></button>; })}</div>
        </section>;
      })}
      {selected.teachingPlan.length < 3 && <section className="gap-picker"><div><p className="section-kicker">Brechas disponibles</p><h2>Añadir otra prioridad</h2><p>SO no se prescribe como capacitación: primero debe obtenerse evidencia.</p></div><div>{gaps.filter((item) => !selected.teachingPlan.some((priority) => priority.code === item.code)).map((item) => <button key={item.code} onClick={() => addPriority(item)}><Plus size={14} /> {item.code} · {item.title}</button>)}</div></section>}
      <div className="sticky-actions"><div><strong>{selected.teachingPlan.length}/3 prioridades</strong><small>{ready ? "Criterios listos para abrir la reevaluación." : "Completa BST, dominio y generalización."}</small></div><button className="secondary-formation-button" onClick={() => persist(selected)} disabled={saving}><Save size={16} /> Guardar plan</button><button className="primary-formation-button" onClick={openReevaluation} disabled={!ready}>Abrir reevaluación <RefreshCcw size={16} /></button></div>
    </>;
  }

  function renderComparison() {
    if (!selected) return null;
    const packs = areasForPackage(selected.instrumentSnapshot, selected.routeType);
    const improvement = improvementSummary(selected);
    return <>
      <div className="work-header"><button className="back-button" onClick={() => setScreen(null)}><ArrowLeft size={17} /> Volver</button><div><p className="section-kicker">Comparación del ciclo</p><h1>{selected.participantName}</h1><p>Sede {selected.site} · {selected.programContext}</p></div><div className="header-actions"><button className="secondary-formation-button" onClick={() => openHistory(selected)}><Clock3 size={15}/> Historial</button><div className="version-lock"><CheckCircle2 size={17} /><span>Ciclo</span><strong>{selected.archivedAt ? "Archivado · solo lectura" : "Evaluado y reevaluado"}</strong></div></div></div>
      {selected.archivedAt && <section className="archive-banner"><Archive size={21}/><div><strong>Este ciclo está archivado y protegido contra cambios.</strong><p>La línea base, la enseñanza, la reevaluación y su historial permanecen disponibles como evidencia longitudinal.</p></div><button className="secondary-formation-button" onClick={() => openNextPackage(selected)}><Plus size={16}/> Iniciar nuevo paquete</button></section>}
      <section className="no-global-score"><BarChart3 size={21} /><div><strong>La comparación se presenta por área; no existe una nota global.</strong><p>Esto evita que una fortaleza compense una brecha crítica de seguridad, dignidad, función o integridad de datos.</p></div></section>
      <section className="comparison-table formation-panel">
        <div className="comparison-head"><span>Área</span><span>Evaluación inicial</span><span>Reevaluación</span><span>Cambio descriptivo</span></div>
        {packs.map((pack) => {
          const before = packageSummary(pack, selected.initialScores);
          const after = packageSummary(pack, selected.reevaluationScores);
          const change = after.strength - before.strength;
          return <div className="comparison-row" key={pack.key}><div><small>{pack.label}</small><strong>{pack.short}</strong></div><div><strong>{before.strength}/{pack.items.length} confirmados</strong><small>{before.gaps} brechas · {before.pending} pendientes</small></div><div><strong>{after.strength}/{pack.items.length} confirmados</strong><small>{after.gaps} brechas · {after.pending} pendientes</small></div><span className={`change-chip ${change > 0 ? "positive" : change < 0 ? "negative" : "stable"}`}>{change > 0 ? `+${change} criterio${change === 1 ? "" : "s"}` : change < 0 ? `${change} criterios` : "Sin cambio neto"}</span></div>;
        })}
      </section>
      {!selected.archivedAt && <section className="decision-panel archive-decision"><div><p className="section-kicker">Cierre del paquete</p><h2>{improvement.net > 0 ? "La comparación muestra una mejora verificable" : "Aún no se confirma una mejora neta"}</h2><p>{improvement.net > 0 ? `${improvement.improvedPackages} área${improvement.improvedPackages === 1 ? "" : "s"} mejoraron; las fortalezas confirmadas pasaron de ${improvement.before} a ${improvement.after}. Revisa la validez clínica antes de archivar.` : "El archivo se habilita solo cuando la reevaluación supera la línea base. Mantén apoyo o modifica la enseñanza y vuelve a comprobar."}</p></div><div className="archive-callout"><span className={`change-chip ${improvement.net > 0 ? "positive" : "stable"}`}>{improvement.net > 0 ? `+${improvement.net} criterios confirmados` : "Sin mejora positiva"}</span><button className="primary-formation-button" disabled={improvement.net <= 0} onClick={() => { setArchiveTarget(selected); setImprovementConfirmed(false); }}><Archive size={16}/> Confirmar mejora y archivar</button></div></section>}
    </>;
  }

  function renderSettings() {
    return <>
      <div className="formation-heading"><div><p className="section-kicker">Cuenta y plataforma</p><h1>Configuración</h1><p>Protege tu cuenta y, si tu rol lo permite, administra la identidad visual.</p></div></div>
      <section className="settings-grid account-security-grid">
        <article className="formation-panel settings-card password-settings-card"><div className="settings-card-heading"><span><KeyRound size={20}/></span><div><h2>Cambiar contraseña</h2><p>La identidad se verificará mediante el correo asociado a tu cuenta.</p></div></div><div className="password-account"><small>Correo verificado</small><strong>{account.email}</strong></div><button className="primary-formation-button" disabled={passwordSending} onClick={requestPasswordChange}>{passwordSending ? <LoaderCircle className="spin" size={16}/> : <KeyRound size={16}/>} Enviar enlace de verificación</button></article>
      </section>
      {can("settings.manage") && <><div className="formation-heading settings-subheading"><div><p className="section-kicker">Personalización</p><h2>Identidad de la plataforma</h2></div></div><section className="settings-grid">
        <article className="formation-panel settings-card page-name-card">
          <div className="settings-card-heading"><span><Pencil size={20}/></span><div><h2>Nombre de la página</h2><p>Aparece en el menú, la barra superior y la pestaña del navegador.</p></div></div>
          <label><span>Nombre visible</span><input maxLength={60} value={pageNameDraft} onChange={(event) => setPageNameDraft(event.target.value)} /></label>
          <div className="settings-actions"><small>{pageNameDraft.trim().length}/60 caracteres</small><button className="primary-formation-button" disabled={saving || !pageNameDraft.trim() || pageNameDraft === settings.pageName} onClick={saveSettings}><Save size={16}/> Guardar nombre</button></div>
        </article>
        <BrandImageCard kind="platform" title="Imagen de la plataforma" description="Reemplaza el símbolo de la plataforma en la navegación." imageUrl={settings.platformPhotoUrl} uploading={imageUploading === "platform"} onUpload={uploadBrandImage} />
        <BrandImageCard kind="institution" title="Foto de la institución" description="Identifica visualmente a la institución en el perfil del sistema." imageUrl={settings.institutionPhotoUrl} uploading={imageUploading === "institution"} onUpload={uploadBrandImage} />
      </section><section className="settings-note"><ShieldAlert size={20}/><div><strong>Configuración institucional protegida</strong><p>Solo las cuentas cuyo rol tenga este permiso pueden modificar la identidad visual de la plataforma.</p></div></section></>}
    </>;
  }

  const openScheduledSession = (appointment: CalendarAppointment) => {
    chooseProfile(appointment.profileId);
    setAppointmentToOpen(appointment);
    setSessionHistoryOnly(false);
    setActive("Sesiones");
  };
  const openProgramGraph = (programId: string) => {
    setSelectedGraphProgramId(programId);
    setActive("Gráficas");
  };
  const openABC = () => {
    if (!selectedProfile) return flash("Selecciona un niño para abrir su Registro ABC.");
    setActive("Registro ABC");
  };
  const mainContent = screen === "initial" ? renderEvaluation("initial")
    : screen === "teaching" ? renderTeaching()
    : screen === "reevaluation" ? renderEvaluation("reevaluation")
    : screen === "comparison" ? renderComparison()
    : active === "Inicio" ? renderOverview()
    : active === "Formación" ? <FormationManager notify={flash}/>
    : active === "Calendario" ? <CalendarManager profiles={profiles} notify={flash} onOpenSession={openScheduledSession}/>
    : active === "Reunión" ? <MeetingManager notify={flash}/>
    : active === "Niños" ? <PersonnelProfileManager profiles={profiles} sites={activeSiteNames} linkableAccounts={linkableAccounts} canManage={canManageChildren} selectedProfileId={selectedProfileId} onSelect={chooseProfile} onProfilesChange={handleProfilesChange} onOpenPrograms={() => setActive("Programas")} onOpenEvaluations={() => setActive("Evaluaciones")} onOpenSessions={() => { setSessionHistoryOnly(true); setAppointmentToOpen(null); setActive("Sesiones"); }} onOpenGraphs={() => { setSelectedGraphProgramId(null); setActive("Gráficas"); }} onOpenProgramGraph={openProgramGraph} onOpenABC={openABC} onOpenReports={() => setActive("Informes")} notify={flash}/>
    : active === "Programas" ? <InterventionSessionManager mode="programs" cycles={records} profiles={profiles} selectedProfileId={selectedProfileId} selectedSite={selectedSite} onSelectProfile={chooseProfile} onProfilesRefresh={() => refreshProfiles().catch((error: Error) => flash(error.message))} notify={flash} canManagePrograms={canManagePrograms} canRecordSessions={canRecordSessions} canManageSessions={canManageSessions} onOpenProgramGraph={openProgramGraph}/>
    : active === "Sesiones" ? <InterventionSessionManager mode="sessions" cycles={records} profiles={profiles} selectedProfileId={selectedProfileId} selectedSite={selectedSite} onSelectProfile={chooseProfile} onProfilesRefresh={() => refreshProfiles().catch((error: Error) => flash(error.message))} notify={flash} canManagePrograms={canManagePrograms} canRecordSessions={canRecordSessions} canManageSessions={canManageSessions} canManageSessionNoteTemplates={account.role === "direccion_clinica"} initialAppointment={appointmentToOpen} onAppointmentConsumed={consumeAppointment} allowAdHocSessions={account.role !== "terapeuta"} historyOnly={sessionHistoryOnly} onRegisterABC={canRecordABC ? setAbcQuickContext : undefined}/>
    : active === "Gráficas" ? <GraphManager cycles={records} profiles={profiles} selectedProfileId={selectedProfileId} initialProgramId={selectedGraphProgramId} notify={flash} canManage={canManageGraphs} onOpenABC={canUseABC && selectedProfileId !== "all" ? openABC : undefined}/>
    : active === "Registro ABC" && selectedProfile && canUseABC ? <ABCManager profileId={selectedProfile.id} profileName={selectedProfile.fullName} notify={flash}/>
    : active === "Informes" ? <ReportManager profiles={profiles} selectedProfileId={selectedProfileId} onSelectProfile={chooseProfile} canManage={canManageReports} brandName={settings.pageName} logoUrl={settings.institutionPhotoUrl || settings.platformPhotoUrl} accountName={account.displayName} notify={flash}/>
    : active === "Paquetes" ? <PackageManager packages={evaluationPackages} onPackagesChange={setEvaluationPackages} notify={flash}/>
    : active === "Equipo" ? <TeamProfileDirectory viewerRole={account.role} canOpenChildren={canViewChildren} onOpenChild={(profileId) => { chooseProfile(profileId); setActive("Niños"); }} notify={flash}/>
    : active === "Cuentas" ? <AccountManager profiles={profiles} sites={activeSiteNames} currentRole={account.role} notify={flash}/>
    : active === "Permisos" ? <PermissionManager notify={flash}/>
    : active === "Sedes" ? <SiteManager canManage={can("sites.manage")} notify={flash} onSitesChange={setSites}/>
    : active === "Configuración" ? renderSettings()
    : renderList();
  const selectedFormPackage = editingRecord?.instrumentSnapshot || activePackages.find((pack) => pack.id === form.packageTemplateId) || activePackages[0] || DEFAULT_EVALUATION_PACKAGE;
  const selectedFormHasRoutes = selectedFormPackage.areas.some((area) => area.route === "4A" || area.route === "4B");
  const formProfile = profiles.find((profile) => profile.id === form.profileId) || null;
  const selectorProfiles = profiles.filter((profile) => profile.status === "active" && (selectedSite === "Todas" || profile.site === selectedSite));

  return <div className="formation-shell"><a className="skip-link" href="#main-content">Saltar al contenido principal</a>
    {menuOpen && <button className="formation-scrim" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)} />}
    <aside className={`formation-sidebar ${menuOpen ? "is-open" : ""}`}>
      <div className="formation-brand"><span>{settings.platformPhotoUrl ? <img src={settings.platformPhotoUrl} alt="" /> : <Sparkles size={20} />}</span><div><strong>{settings.pageName}</strong><small>Plataforma clínica CIE</small></div><button className="mobile-close" aria-label="Cerrar menú" onClick={() => setMenuOpen(false)}><X size={19} /></button></div>
      <p className="nav-kicker">Navegación</p>
      <nav aria-label="Navegación principal">{visibleNav.map(([label, Icon]) => <button key={label} title={label} aria-current={active === label && !screen ? "page" : undefined} className={`formation-nav ${active === label && !screen ? "active" : ""}`} onClick={() => { if (label === "Portal de formación") { window.location.assign("/formacion"); return; } setActive(label); setScreen(null); setMenuOpen(false); }}><Icon size={20} /><span>{label}</span></button>)}</nav>
      <div className="sidebar-spacer" /><button className={`formation-nav ${active === "Configuración" && !screen ? "active" : ""}`} onClick={() => { setActive("Configuración"); setScreen(null); setMenuOpen(false); }}><Settings size={18} /><span>Configuración</span></button><div className="signed-user"><ProfilePhoto name={account.displayName} src={accountPhotoUrl} avatarClassName="signed-user-avatar" editable uploading={accountPhotoUploading} onFile={changeAccountPhoto} label="Cambiar mi fotografía"/><div><strong>{account.displayName}</strong><small>{roleLabel(account.role)}</small></div><button aria-label="Cerrar sesión" title="Cerrar sesión" onClick={signOut}><LogOut size={15}/></button></div>
    </aside>
    <section className="formation-workspace"><header className="formation-topbar">
      <button className="mobile-menu" aria-label="Abrir menú" onClick={() => setMenuOpen(true)}><Menu size={20} /></button>
      <div className="topbar-context"><span>{settings.pageName}</span><strong>{active}</strong></div>
      {canViewChildren && <div className="topbar-profile-filters" aria-label="Contexto clínico"><Search size={16}/><label><span className="sr-only">Sede</span><select value={selectedSite} onChange={(event) => { const next = event.target.value; setSelectedSite(next); if (selectedProfile && next !== "Todas" && selectedProfile.site !== next) setSelectedProfileId("all"); setScreen(null); }}><option value="Todas">Todas las sedes</option>{activeSiteNames.map((site) => <option value={site} key={site}>{site}</option>)}</select></label><label><span className="sr-only">Niño</span><select value={selectorProfiles.some((profile) => profile.id === selectedProfileId) ? selectedProfileId : "all"} onChange={(event) => chooseProfile(event.target.value)}><option value="all">{selectedSite === "Todas" ? "Todos los niños" : `Todos · ${selectedSite}`}</option>{selectorProfiles.map((profile) => <option value={profile.id} key={profile.id}>{profile.fullName}</option>)}</select></label></div>}
      <div className="topbar-actions"><span className="topbar-date"><CalendarDays size={15}/>{new Date().toLocaleDateString("es-NI", { day: "2-digit", month: "short" })}</span>{selectedProfile && canRecordABC && <button className="topbar-abc" title={`Registrar ABC · ${selectedProfile.fullName}`} aria-label={`Registrar ABC para ${selectedProfile.fullName}`} onClick={() => setAbcQuickContext({ profileId: selectedProfile.id, profileName: selectedProfile.fullName })}><ListTree size={18}/><span>ABC</span></button>}{(can("calendar.view") || can("calendar.manage")) && <button title="Calendario" aria-label="Abrir calendario" onClick={() => { setActive("Calendario"); setScreen(null); }}><CalendarDays size={18}/></button>}<button title="CIE Nexus Formación" aria-label="Abrir CIE Nexus Formación" onClick={() => window.location.assign("/formacion")}><CircleHelp size={19}/></button><button className="topbar-avatar-button" title={account.displayName} aria-label={`Configuración de ${account.displayName}`} onClick={() => { setActive("Configuración"); setScreen(null); }}><ProfilePhoto name={account.displayName} src={accountPhotoUrl} avatarClassName="topbar-avatar"/></button></div>
    </header><main id="main-content" tabIndex={-1} className={`formation-content ${screen ? "work-mode" : ""}`}>{mainContent}</main></section>
    {message && <div className="formation-toast" role="status" aria-live="polite"><CheckCircle2 size={17} /> {message}</div>}
    {abcQuickContext && <ABCQuickCapture context={abcQuickContext} onClose={() => setAbcQuickContext(null)} notify={flash}/>}
    {newOpen && <div className="modal-backdrop"><section className="new-cycle-modal" role="dialog" aria-modal="true" aria-labelledby="new-cycle-title">
      <div className="modal-title"><div><p className="section-kicker">{editingRecord ? "Gestión del expediente" : form.sourceCycleId ? "Continuidad longitudinal" : "Nueva línea base"}</p><h2 id="new-cycle-title">{editingRecord ? "Editar evaluación" : form.sourceCycleId ? "Iniciar nuevo ciclo" : "Iniciar evaluación"}</h2></div><button aria-label="Cerrar" onClick={() => { setNewOpen(false); setEditingId(null); }}><X size={19}/></button></div>
      <p className="modal-intro">{editingRecord ? "Actualiza los datos administrativos. El paquete, la versión, las puntuaciones y las evidencias se conservarán." : form.sourceCycleId ? "Los datos generales se copiaron del ciclo archivado. Selecciona el paquete que funcionará como nueva línea base." : "Selecciona un paquete publicado. El sistema guardará una copia de esa versión para utilizarla nuevamente en la reevaluación."}</p>
      <div className="modal-form">
        <label className="field-wide"><span>Niño</span><select autoFocus value={form.profileId} onChange={(event) => { const profile = profiles.find((item) => item.id === event.target.value); setForm({ ...form, profileId: profile?.id || "", participantName: profile?.fullName || "", site: profile?.site || "León", role: "Niño" }); }}>{profiles.filter((profile) => profile.status === "active" || profile.id === form.profileId).map((profile) => <option value={profile.id} key={profile.id}>{profile.fullName} · {profile.site}</option>)}</select>{formProfile && <small className="profile-field-note">La evaluación quedará dentro del expediente de {formProfile.fullName} en la sede {formProfile.site}.</small>}</label>
        <label><span>Programa o contexto principal</span><input value={form.programContext} onChange={(event) => setForm({ ...form, programContext: event.target.value })} placeholder="Ej. Comunicación funcional" /></label>
        {!editingRecord && <label className="field-wide package-select-field"><span>Paquete de evaluación</span><select value={form.packageTemplateId} onChange={(event) => setForm({ ...form, packageTemplateId: event.target.value })}>{activePackages.map((pack) => <option value={pack.id} key={pack.id}>{pack.name} · v{pack.version}.0</option>)}</select><small>{selectedFormPackage.objective}</small></label>}
        {selectedFormHasRoutes && <label className="field-wide"><span>Ruta de aplicación</span><div className="route-choice"><button type="button" disabled={Boolean(editingRecord)} aria-pressed={form.routeType === "4A"} className={form.routeType === "4A" ? "selected" : ""} onClick={() => setForm({ ...form, routeType: "4A" })}><strong>4A · Adquisición</strong><small>El programa enseña una habilidad.</small></button><button type="button" disabled={Boolean(editingRecord)} aria-pressed={form.routeType === "4B"} className={form.routeType === "4B" ? "selected" : ""} onClick={() => setForm({ ...form, routeType: "4B" })}><strong>4B · Conducta que interfiere</strong><small>El plan modifica riesgo o contingencias.</small></button></div></label>}
      </div>
      <div className="modal-foot"><span><FileCheck2 size={15}/> {editingRecord ? editingRecord.instrumentVersion : packageVersionLabel(selectedFormPackage)}</span><div><button className="secondary-formation-button" onClick={() => { setNewOpen(false); setEditingId(null); }}>Cancelar</button><button className="primary-formation-button" onClick={saveMetadata} disabled={saving || (!editingRecord && !activePackages.length)}>{saving ? <LoaderCircle className="spin" size={16}/> : editingRecord ? <Save size={16}/> : <ClipboardCheck size={16}/>} {editingRecord ? "Guardar cambios" : "Crear evaluación"}</button></div></div>
    </section></div>}
    {deleteTarget && <div className="modal-backdrop"><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description"><span className="danger-mark"><Trash2 size={23}/></span><h2 id="delete-title">Eliminar evaluación permanentemente</h2><p id="delete-description">Se eliminarán la línea base, el plan de enseñanza, la reevaluación y <strong>todo su historial de modificaciones</strong> de {deleteTarget.participantName}. Esta acción no se puede deshacer.</p><label><span>Escribe ELIMINAR para confirmar</span><input autoFocus value={deleteText} onChange={(event) => setDeleteText(event.target.value)} /></label><div><button className="secondary-formation-button" onClick={() => { setDeleteTarget(null); setDeleteText(""); }}>Cancelar</button><button className="danger-button" disabled={deleteText.trim().toUpperCase() !== "ELIMINAR" || saving} onClick={deleteCycle}><Trash2 size={16}/> Eliminar permanentemente</button></div></section></div>}
    {archiveTarget && <div className="modal-backdrop"><section className="archive-modal" role="dialog" aria-modal="true" aria-labelledby="archive-title"><div className="modal-title"><div><p className="section-kicker">Cierre longitudinal</p><h2 id="archive-title">Confirmar mejora y archivar</h2></div><button aria-label="Cerrar" onClick={() => { setArchiveTarget(null); setImprovementConfirmed(false); }}><X size={19}/></button></div><div className="archive-summary"><span><Archive size={22}/></span><div><strong>{archiveTarget.participantName}</strong><p>{archiveTarget.programContext} · Sede {archiveTarget.site}</p></div></div>{(() => { const summary = improvementSummary(archiveTarget); const total = targetsForPackage(archiveTarget.instrumentSnapshot, archiveTarget.routeType).length; return <><div className="archive-evidence"><div><small>Línea base</small><strong>{summary.before}/{total}</strong></div><ArrowRight size={18}/><div><small>Reevaluación</small><strong>{summary.after}/{total}</strong></div><span className="change-chip positive">+{summary.net}</span></div><p className="modal-intro">Archivar protege este ciclo contra cambios y lo mueve fuera de los listados activos. Después podrás iniciar una evaluación nueva con el paquete que elijas.</p></>; })()}<label className="confirm-check"><input type="checkbox" checked={improvementConfirmed} onChange={(event) => setImprovementConfirmed(event.target.checked)} /><span>Confirmo que revisé la comparación y que la mejora es clínicamente válida, no solo un cambio numérico.</span></label><div className="modal-actions"><button className="secondary-formation-button" onClick={() => { setArchiveTarget(null); setImprovementConfirmed(false); }}>Cancelar</button><button className="primary-formation-button" disabled={!improvementConfirmed || saving} onClick={archiveCycle}>{saving ? <LoaderCircle className="spin" size={16}/> : <Archive size={16}/>} Archivar ciclo</button></div></section></div>}
    {historyTarget && <div className="modal-backdrop"><section className="history-modal" role="dialog" aria-modal="true" aria-labelledby="history-title"><div className="modal-title"><div><p className="section-kicker">Trazabilidad</p><h2 id="history-title">Historial de modificaciones</h2></div><button aria-label="Cerrar historial" onClick={() => setHistoryTarget(null)}><X size={19}/></button></div><p className="modal-intro"><strong>{historyTarget.participantName}</strong> · {historyTarget.programContext}. Este historial pertenece a la evaluación y se eliminará automáticamente si eliminas el expediente.</p><div className="history-timeline">{historyLoading ? <div className="empty-state"><LoaderCircle className="spin" size={24}/><strong>Cargando historial…</strong></div> : history.length ? history.map((entry) => <article key={entry.id}><span><Clock3 size={15}/></span><div><strong>{entry.summary}</strong>{entry.details && <p>{entry.details}</p>}<small>{new Date(entry.createdAt).toLocaleString("es-NI", { dateStyle: "medium", timeStyle: "short" })}</small></div></article>) : <div className="empty-state"><CircleDashed size={26}/><strong>Sin modificaciones registradas</strong></div>}</div><div className="modal-actions"><button className="secondary-formation-button" onClick={() => setHistoryTarget(null)}>Cerrar</button></div></section></div>}
  </div>;
}
