import { apiAccountGuard, roleLabel } from "../../../../lib/access-control";

export async function GET() {
  const { account, denied } = await apiAccountGuard();
  if (denied || !account) return denied;
  return Response.json({
    account: {
      id: account.id,
      email: account.email,
      username: account.username,
      displayName: account.displayName,
      role: account.role,
      roleLabel: roleLabel(account.role),
      siteScope: account.siteScope,
      personnelProfileId: account.personnelProfileId,
      assignedProfileIds: account.assignedProfileIds,
      permissions: account.permissions,
    },
  });
}
