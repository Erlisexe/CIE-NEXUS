import {
  apiAccountGuard,
  PERMISSION_CATALOG,
  ROLE_ORDER,
  type AppPermission,
  type AppRole,
} from "../../../lib/access-control";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

const validRoles = new Set<AppRole>(ROLE_ORDER);
const validPermissions = new Set<AppPermission>(PERMISSION_CATALOG.map((item) => item.key));

function cleanPermissions(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is AppPermission => typeof item === "string" && validPermissions.has(item as AppPermission)))];
}

export async function GET() {
  const { account, denied } = await apiAccountGuard({ roles: ["direccion_clinica"] });
  if (denied || !account) return denied;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("role_permissions")
    .select("role,permission_key,allowed,updated_at")
    .order("role")
    .order("permission_key");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ permissions: data || [] });
}

export async function PUT(request: Request) {
  const { account, denied } = await apiAccountGuard({ roles: ["direccion_clinica"] });
  if (denied || !account) return denied;
  const body = await request.json() as Record<string, unknown>;
  const role = typeof body.role === "string" ? body.role as AppRole : null;
  if (!role || !validRoles.has(role)) return Response.json({ error: "Selecciona un rol válido." }, { status: 400 });

  const selected = role === "direccion_clinica"
    ? PERMISSION_CATALOG.map((item) => item.key)
    : cleanPermissions(body.permissions);
  const selectedSet = new Set<AppPermission>(selected);
  const now = new Date().toISOString();
  const rows = PERMISSION_CATALOG.map((item) => ({
    role,
    permission_key: item.key,
    allowed: selectedSet.has(item.key),
    updated_at: now,
    updated_by: account.id,
  }));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("role_permissions").upsert(rows, { onConflict: "role,permission_key" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  await supabase.from("account_audit_log").insert({
    actor_account_id: account.id,
    action: "role_permissions_updated",
    details: { role, permissions: selected },
  });
  return Response.json({ role, permissions: selected, updatedAt: now });
}
