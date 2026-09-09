import { asc } from "drizzle-orm";
import { getDb } from "../../../db";
import { interventionPrograms, interventionSessions, personnelProfiles, trainingCycles } from "../../../db/schema";
import { apiAccountGuard, canViewTeamRole, hasPermission, visibleProfileIds, type AppRole } from "../../../lib/access-control";
import { signedProfilePhotoMap } from "../../../lib/profile-photos";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

type AccountRow = {
  id: string;
  auth_user_id: string | null;
  email: string;
  username: string;
  display_name: string;
  role: AppRole;
  status: "invited" | "active" | "suspended";
  site_scope: string[] | null;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

export async function GET() {
  const { account, denied } = await apiAccountGuard({ roles: ["direccion_clinica", "subdirector", "supervisor", "coordinador"] });
  if (denied || !account) return denied;
  try {
    const supabase = await createSupabaseServerClient();
    const [{ data: rawAccounts, error: accountError }, { data: rawAssignments, error: assignmentError }] = await Promise.all([
      supabase.from("app_accounts").select("id,auth_user_id,email,username,display_name,role,status,site_scope,created_at,updated_at,last_login_at").order("display_name"),
      supabase.from("account_assignments").select("account_id,profile_id"),
    ]);
    if (accountError || assignmentError) throw new Error(accountError?.message || assignmentError?.message || "No se pudo consultar el equipo.");

    const accounts = (rawAccounts || []) as AccountRow[];
    const visibleAccounts = accounts.filter((item) => item.id !== account.id && canViewTeamRole(account.role, item.role));
    const photoUrls = await signedProfilePhotoMap(supabase, "account", visibleAccounts.map((item) => item.id));
    const visibleAccountIds = new Set(visibleAccounts.map((item) => item.id));
    const assignments = (rawAssignments || []).filter((item) => visibleAccountIds.has(String(item.account_id))).map((item) => ({ accountId: String(item.account_id), profileId: String(item.profile_id) }));

    const db = await getDb();
    const [profiles, cycles, programs, sessions] = await Promise.all([
      db.select().from(personnelProfiles).orderBy(asc(personnelProfiles.site), asc(personnelProfiles.fullName)),
      db.select({ id: trainingCycles.id, profileId: trainingCycles.profileId }).from(trainingCycles),
      db.select({ id: interventionPrograms.id, profileId: interventionPrograms.profileId }).from(interventionPrograms),
      db.select({ id: interventionSessions.id, programId: interventionSessions.programId }).from(interventionSessions),
    ]);
    const canOpenChildren = hasPermission(account, "children.view");
    const accessibleChildIds = canOpenChildren ? visibleProfileIds(account, profiles) : new Set<string>();
    const childPhotoUrls = await signedProfilePhotoMap(supabase, "child", [...accessibleChildIds]);
    const programOwner = new Map(programs.map((program) => [program.id, program.profileId]));

    return Response.json({
      profiles: visibleAccounts.map((professional) => {
        const assignedIds = assignments.filter((item) => item.accountId === professional.id).map((item) => item.profileId);
        const assignedSet = new Set(assignedIds);
        const children = profiles.filter((profile) => assignedSet.has(profile.id) && accessibleChildIds.has(profile.id)).map((profile) => ({
          id: profile.id,
          fullName: profile.fullName,
          site: profile.site,
          internalCode: profile.internalCode,
          status: profile.status,
          evaluationCount: cycles.filter((cycle) => cycle.profileId === profile.id).length,
          programCount: programs.filter((program) => program.profileId === profile.id).length,
          sessionCount: sessions.filter((session) => programOwner.get(session.programId) === profile.id).length,
          photoUrl: childPhotoUrls.get(profile.id) || null,
        }));
        return {
          id: professional.id,
          displayName: professional.display_name,
          username: professional.username,
          email: professional.email,
          role: professional.role,
          status: professional.status,
          activationState: professional.auth_user_id ? "activated" : "pending",
          siteScope: Array.isArray(professional.site_scope) ? professional.site_scope : [],
          assignedChildCount: assignedIds.length,
          children,
          createdAt: professional.created_at,
          updatedAt: professional.updated_at,
          lastLoginAt: professional.last_login_at,
          photoUrl: photoUrls.get(professional.id) || null,
          canManagePhoto: hasPermission(account, "accounts.manage"),
        };
      }),
      viewerRole: account.role,
      canOpenChildren,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo cargar el equipo clínico." }, { status: 500 });
  }
}
