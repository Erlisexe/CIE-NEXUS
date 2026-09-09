import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAccessTokenClient, createSupabaseServerClient } from "./supabase/server";
import { canAccessProfileByScope } from "./resource-scope";

export const CIE_SITES = ["León", "Estelí", "Santo Domingo", "Las Colinas", "Masaya"] as const;

export const ROLE_ORDER = ["direccion_clinica", "subdirector", "supervisor", "coordinador", "terapeuta"] as const;
export type AppRole = typeof ROLE_ORDER[number];
export type PermissionLevel = "view" | "record" | "manage";

export const PERMISSION_CATALOG = [
  { key: "children.view", group: "Niños", label: "Consultar niños", description: "Ver los niños incluidos en su alcance." },
  { key: "children.manage", group: "Niños", label: "Administrar niños", description: "Crear, editar, archivar y vincular responsables." },
  { key: "evaluations.view", group: "Evaluaciones", label: "Consultar evaluaciones", description: "Revisar evaluaciones e historial." },
  { key: "evaluations.manage", group: "Evaluaciones", label: "Administrar evaluaciones", description: "Crear, modificar, archivar y eliminar evaluaciones." },
  { key: "programs.view", group: "Programas", label: "Consultar programas", description: "Ver programas y targets clínicos." },
  { key: "programs.manage", group: "Programas", label: "Administrar programas", description: "Crear, modificar y eliminar programas y targets." },
  { key: "sessions.view", group: "Sesiones", label: "Consultar sesiones", description: "Revisar sesiones registradas." },
  { key: "sessions.record", group: "Sesiones", label: "Registrar sesiones", description: "Cerrar y guardar nuevas sesiones." },
  { key: "sessions.manage", group: "Sesiones", label: "Corregir sesiones", description: "Editar o eliminar sesiones existentes." },
  { key: "calendar.view", group: "Calendario", label: "Consultar calendario", description: "Ver las sesiones programadas dentro de su alcance." },
  { key: "calendar.manage", group: "Calendario", label: "Administrar calendario", description: "Programar, reasignar y cancelar sesiones." },
  { key: "graphs.view", group: "Gráficas", label: "Consultar gráficas", description: "Ver gráficas dentro de su alcance." },
  { key: "graphs.manage", group: "Gráficas", label: "Administrar gráficas", description: "Crear, modificar, archivar y eliminar gráficas." },
  { key: "abc.view", group: "Registro ABC", label: "Consultar registros ABC", description: "Ver el historial y los análisis descriptivos ABC dentro de su alcance." },
  { key: "abc.record", group: "Registro ABC", label: "Registrar ABC", description: "Documentar antecedentes, conductas y consecuencias observadas." },
  { key: "abc.manage", group: "Registro ABC", label: "Administrar Registro ABC", description: "Corregir registros y configurar categorías descriptivas." },
  { key: "reports.view", group: "Informes", label: "Consultar informes", description: "Ver informes y plantillas dentro de su alcance clínico." },
  { key: "reports.manage", group: "Informes", label: "Administrar informes", description: "Crear, editar, finalizar, duplicar y guardar plantillas." },
  { key: "training.manage", group: "Institución", label: "Administrar Formación", description: "Crear y publicar contenido del campus." },
  { key: "packages.manage", group: "Institución", label: "Administrar paquetes", description: "Crear y versionar instrumentos de evaluación." },
  { key: "accounts.manage", group: "Institución", label: "Administrar cuentas", description: "Autorizar, editar, suspender y revocar cuentas." },
  { key: "settings.manage", group: "Institución", label: "Administrar configuración", description: "Cambiar identidad e imágenes de la plataforma." },
  { key: "permissions.manage", group: "Institución", label: "Configurar permisos", description: "Modificar la matriz de permisos por rol." },
  { key: "sites.view", group: "Institución", label: "Consultar sedes", description: "Ver el directorio institucional de sedes." },
  { key: "sites.manage", group: "Institución", label: "Administrar sedes", description: "Crear, editar y desactivar sedes sin romper historiales." },
] as const;

export type AppPermission = typeof PERMISSION_CATALOG[number]["key"];

export type AppAccount = {
  id: string;
  authUserId: string;
  email: string;
  username: string;
  displayName: string;
  role: AppRole;
  status: "invited" | "active" | "suspended";
  personnelProfileId: string | null;
  siteScope: string[];
  assignedProfileIds: string[];
  permissions: AppPermission[];
};

type AccountRow = {
  id: string;
  auth_user_id: string | null;
  email: string;
  username: string;
  display_name: string;
  role: AppRole;
  status: AppAccount["status"];
  personnel_profile_id: string | null;
  site_scope: string[] | null;
};

export const roleLabel = (role: AppRole) => ({
  direccion_clinica: "Dirección Clínica",
  subdirector: "Subdirector clínico",
  supervisor: "Supervisor clínico",
  coordinador: "Coordinador clínico",
  terapeuta: "Terapeuta clínico",
})[role];

const TEAM_ROLE_VISIBILITY: Record<AppRole, AppRole[]> = {
  direccion_clinica: ["subdirector", "supervisor", "coordinador", "terapeuta"],
  subdirector: ["supervisor", "coordinador", "terapeuta"],
  supervisor: ["coordinador", "terapeuta"],
  coordinador: ["terapeuta"],
  terapeuta: [],
};

export function canViewTeamRole(viewerRole: AppRole, targetRole: AppRole) {
  return TEAM_ROLE_VISIBILITY[viewerRole].includes(targetRole);
}

export function canViewTeamProfiles(role: AppRole) {
  return TEAM_ROLE_VISIBILITY[role].length > 0;
}

export function hasPermission(account: AppAccount, permission: AppPermission) {
  return account.role === "direccion_clinica" || account.permissions.includes(permission);
}

async function loadAccountForAuthUser(supabase: SupabaseClient, authUserId: string): Promise<AppAccount | null> {
  const { data: rawAccount, error: accountError } = await supabase
    .from("app_accounts")
    .select("id,auth_user_id,email,username,display_name,role,status,personnel_profile_id,site_scope")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  const row = rawAccount as AccountRow | null;
  if (accountError || !row || row.status !== "active" || !row.auth_user_id) return null;

  const [{ data: assignmentRows }, { data: permissionRows }] = await Promise.all([
    supabase.from("account_assignments").select("profile_id").eq("account_id", row.id),
    supabase.from("role_permissions").select("permission_key").eq("role", row.role).eq("allowed", true),
  ]);
  const validPermissions = new Set(PERMISSION_CATALOG.map((item) => item.key));

  return {
    id: row.id,
    authUserId: row.auth_user_id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    status: row.status,
    personnelProfileId: row.personnel_profile_id,
    siteScope: Array.isArray(row.site_scope) ? row.site_scope : [],
    assignedProfileIds: (assignmentRows || []).map((item) => String(item.profile_id)),
    permissions: (permissionRows || []).map((item) => String(item.permission_key)).filter((item): item is AppPermission => validPermissions.has(item as AppPermission)),
  };
}

export async function getCurrentAccount(): Promise<AppAccount | null> {
  const supabase = await createSupabaseServerClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const authUserId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
  if (claimsError || !authUserId) return null;
  return loadAccountForAuthUser(supabase, authUserId);
}

export async function getAccountFromAccessToken(accessToken: string): Promise<AppAccount | null> {
  const supabase = createSupabaseAccessTokenClient(accessToken);
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(accessToken);
  const authUserId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
  if (claimsError || !authUserId) return null;
  return loadAccountForAuthUser(supabase, authUserId);
}

export async function requirePageAccount(returnTo = "/") {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) redirect(`/login?returnTo=${encodeURIComponent(returnTo)}`);
  const account = await getCurrentAccount();
  if (!account) redirect("/acceso-pendiente");
  return account;
}

export async function apiAccountGuard(options?: {
  roles?: AppRole[];
  permissions?: AppPermission[];
  anyPermissions?: AppPermission[];
}) {
  const account = await getCurrentAccount();
  if (!account) {
    return {
      account: null,
      denied: Response.json({ error: "Inicia sesión con una cuenta activa de CIE Nexus." }, { status: 401 }),
    };
  }
  const wrongRole = options?.roles && !options.roles.includes(account.role);
  const missingRequired = options?.permissions?.some((permission) => !hasPermission(account, permission));
  const missingAny = options?.anyPermissions?.length && !options.anyPermissions.some((permission) => hasPermission(account, permission));
  if (wrongRole || missingRequired || missingAny) {
    return {
      account: null,
      denied: Response.json({ error: "Tu rol no permite realizar esta acción." }, { status: 403 }),
    };
  }
  return { account, denied: null };
}

export function canAccessProfile(account: AppAccount, profile: { id: string; site: string }) {
  return canAccessProfileByScope(account, profile);
}

export const canAccessChild = canAccessProfile;

export function canRecordSessions(account: AppAccount) {
  return hasPermission(account, "sessions.record") || hasPermission(account, "sessions.manage");
}

export function visibleProfileIds<T extends { id: string; site: string }>(account: AppAccount, profiles: T[]) {
  return new Set(profiles.filter((profile) => canAccessProfile(account, profile)).map((profile) => profile.id));
}
