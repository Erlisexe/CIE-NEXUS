import { apiAccountGuard, getCurrentAccount, hasPermission, type AppPermission } from "./access-control";

export const ADMIN_EMAIL = "silresaveuc@gmail.com";

export async function isAdminRequest(permission: AppPermission = "accounts.manage") {
  const account = await getCurrentAccount();
  return Boolean(account && hasPermission(account, permission));
}

export async function adminApiGuard(permission: AppPermission = "accounts.manage") {
  const { denied } = await apiAccountGuard({ permissions: [permission] });
  return denied;
}
