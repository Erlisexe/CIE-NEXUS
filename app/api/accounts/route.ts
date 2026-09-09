import { apiAccountGuard, ROLE_ORDER, type AppRole } from "../../../lib/access-control";
import { removeProfilePhotos } from "../../../lib/profile-photos";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { activeSiteNames } from "../../../lib/sites";

const ROLES = new Set<AppRole>(ROLE_ORDER);
const STATUSES = new Set(["invited", "active", "suspended"]);

function text(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function username(value: unknown) {
  return text(value, 40).toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

async function sites(value: unknown) {
  const available = new Set(await activeSiteNames());
  return Array.isArray(value)
    ? [...new Set(value.map((item) => text(item, 80)).filter((item) => available.has(item)))]
    : [];
}

function profileIds(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.map((item) => text(item, 100)).filter(Boolean))].slice(0, 300) : [];
}

function accountError(error: unknown) {
  const message = error && typeof error === "object" && "message" in error ? String(error.message) : "No fue posible guardar la cuenta.";
  if (/unique|duplicate/i.test(message)) return "El correo o el nombre de usuario ya está registrado.";
  return message;
}

export async function GET() {
  const { account, denied } = await apiAccountGuard({ permissions: ["accounts.manage"] });
  if (denied || !account) return denied;
  const supabase = await createSupabaseServerClient();
  const [{ data: accounts, error }, { data: assignments }] = await Promise.all([
    supabase.from("app_accounts").select("id,auth_user_id,email,username,display_name,role,status,personnel_profile_id,site_scope,created_at,updated_at,last_login_at").order("display_name"),
    supabase.from("account_assignments").select("account_id,profile_id,permission_level"),
  ]);
  if (error) return Response.json({ error: accountError(error) }, { status: 500 });
  return Response.json({
    accounts: (accounts || []).map((item) => ({
      ...item,
      assignedProfileIds: (assignments || []).filter((assignment) => assignment.account_id === item.id).map((assignment) => assignment.profile_id),
      activationState: item.auth_user_id ? "activated" : "pending",
    })),
  });
}

export async function POST(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["accounts.manage"] });
  if (denied || !account) return denied;
  const body = await request.json() as Record<string, unknown>;
  const email = text(body.email, 240).toLowerCase();
  const handle = username(body.username);
  const displayName = text(body.displayName, 120);
  const role = text(body.role, 30) as AppRole;
  const siteScope = await sites(body.siteScope);
  const assignedProfileIds = profileIds(body.assignedProfileIds);
  if (!/^\S+@\S+\.\S+$/.test(email) || handle.length < 3 || !displayName || !ROLES.has(role)) {
    return Response.json({ error: "Completa nombre, usuario, correo y rol con valores válidos." }, { status: 400 });
  }
  if (role === "direccion_clinica" && account.role !== "direccion_clinica") {
    return Response.json({ error: "Solo Dirección Clínica puede otorgar este rol." }, { status: 403 });
  }
  if (role === "supervisor" && !siteScope.length) {
    return Response.json({ error: "Asigna al menos una sede a la cuenta de Supervisor." }, { status: 400 });
  }
  const supabase = await createSupabaseServerClient();
  const { data: created, error } = await supabase.from("app_accounts").insert({
    email,
    username: handle,
    display_name: displayName,
    role,
    status: "invited",
    personnel_profile_id: null,
    site_scope: siteScope,
  }).select("id,auth_user_id,email,username,display_name,role,status,personnel_profile_id,site_scope,created_at,updated_at,last_login_at").single();
  if (error || !created) return Response.json({ error: accountError(error) }, { status: 409 });
  const { error: assignmentError } = await supabase.rpc("replace_account_assignments", {
    target_account: created.id,
    profile_ids: assignedProfileIds,
  });
  if (assignmentError) {
    await supabase.from("app_accounts").delete().eq("id", created.id);
    return Response.json({ error: accountError(assignmentError) }, { status: 500 });
  }
  await supabase.from("account_audit_log").insert({
    actor_account_id: account.id,
    target_account_id: created.id,
    action: "account_created",
    details: { email, role, siteScope, assignedProfileIds },
  });
  return Response.json({ account: { ...created, assignedProfileIds, activationState: "pending" } }, { status: 201 });
}

export async function PUT(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["accounts.manage"] });
  if (denied || !account) return denied;
  const body = await request.json() as Record<string, unknown>;
  const id = text(body.id, 100);
  if (!id) return Response.json({ error: "Selecciona una cuenta válida." }, { status: 400 });
  const supabase = await createSupabaseServerClient();
  const { data: current } = await supabase.from("app_accounts").select("id,auth_user_id,email,role,status").eq("id", id).maybeSingle();
  if (!current) return Response.json({ error: "No se encontró la cuenta." }, { status: 404 });
  if (current.role === "direccion_clinica" && account.role !== "direccion_clinica") {
    return Response.json({ error: "Solo Dirección Clínica puede modificar una cuenta con este rol." }, { status: 403 });
  }

  const action = text(body.action, 30);
  if (action === "suspend" || action === "activate") {
    if (id === account.id && action === "suspend") return Response.json({ error: "No puedes suspender tu propia cuenta administrativa." }, { status: 409 });
    const nextStatus = action === "suspend" ? "suspended" : current.auth_user_id ? "active" : "invited";
    const { data: updated, error } = await supabase.from("app_accounts").update({ status: nextStatus, updated_at: new Date().toISOString() }).eq("id", id).select().single();
    if (error) return Response.json({ error: accountError(error) }, { status: 500 });
    await supabase.from("account_audit_log").insert({ actor_account_id: account.id, target_account_id: id, action: action === "suspend" ? "account_suspended" : "account_reactivated" });
    return Response.json({ account: updated });
  }

  const email = text(body.email, 240).toLowerCase();
  const handle = username(body.username);
  const displayName = text(body.displayName, 120);
  const role = text(body.role, 30) as AppRole;
  const siteScope = await sites(body.siteScope);
  const assignedProfileIds = profileIds(body.assignedProfileIds);
  const status = STATUSES.has(text(body.status, 30)) ? text(body.status, 30) : current.status;
  if (!/^\S+@\S+\.\S+$/.test(email) || handle.length < 3 || !displayName || !ROLES.has(role)) {
    return Response.json({ error: "Completa nombre, usuario, correo y rol con valores válidos." }, { status: 400 });
  }
  if (id === account.id && (role !== account.role || status === "suspended")) {
    return Response.json({ error: "No puedes cambiar tu propio rol ni suspender tu cuenta." }, { status: 409 });
  }
  if (role === "direccion_clinica" && account.role !== "direccion_clinica") {
    return Response.json({ error: "Solo Dirección Clínica puede otorgar este rol." }, { status: 403 });
  }
  if (current.auth_user_id && email !== current.email) {
    return Response.json({ error: "El correo de una cuenta ya activada no puede cambiarse desde este panel. Crea una nueva autorización si la persona usará otro correo." }, { status: 409 });
  }
  if (role === "supervisor" && !siteScope.length) return Response.json({ error: "Asigna al menos una sede al Supervisor." }, { status: 400 });

  const { data: updated, error } = await supabase.from("app_accounts").update({
    email,
    username: handle,
    display_name: displayName,
    role,
    status,
    personnel_profile_id: null,
    site_scope: siteScope,
    updated_at: new Date().toISOString(),
  }).eq("id", id).select().single();
  if (error || !updated) return Response.json({ error: accountError(error) }, { status: 409 });
  const { error: assignmentError } = await supabase.rpc("replace_account_assignments", { target_account: id, profile_ids: assignedProfileIds });
  if (assignmentError) return Response.json({ error: accountError(assignmentError) }, { status: 500 });
  await supabase.from("account_audit_log").insert({ actor_account_id: account.id, target_account_id: id, action: "account_updated", details: { role, siteScope, assignedProfileIds } });
  return Response.json({ account: { ...updated, assignedProfileIds, activationState: updated.auth_user_id ? "activated" : "pending" } });
}

export async function DELETE(request: Request) {
  const { account, denied } = await apiAccountGuard({ permissions: ["accounts.manage"] });
  if (denied || !account) return denied;
  const body = await request.json() as Record<string, unknown>;
  const id = text(body.id, 100);
  if (!id) return Response.json({ error: "Selecciona una cuenta válida." }, { status: 400 });
  if (id === account.id) return Response.json({ error: "No puedes eliminar tu propia autorización administrativa." }, { status: 409 });
  const supabase = await createSupabaseServerClient();
  const { data: target } = await supabase.from("app_accounts").select("role").eq("id", id).maybeSingle();
  if (target?.role === "direccion_clinica" && account.role !== "direccion_clinica") {
    return Response.json({ error: "Solo Dirección Clínica puede revocar otra cuenta de Dirección Clínica." }, { status: 403 });
  }
  await removeProfilePhotos(supabase, "account", id).catch(() => undefined);
  const { error } = await supabase.from("app_accounts").delete().eq("id", id);
  if (error) return Response.json({ error: accountError(error) }, { status: 500 });
  return Response.json({ deleted: true, id, clinicalDataPreserved: true });
}
