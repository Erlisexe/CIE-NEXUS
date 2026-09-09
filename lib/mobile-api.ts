import { hasPermission, getAccountFromAccessToken, type AppAccount, type AppPermission } from "./access-control";
import {
  deriveMobileCapabilities,
  extractBearerToken,
  mobileError,
} from "./mobile-api-contract";

export {
  MOBILE_API_VERSION,
  MOBILE_SCOPE_POLICY,
  boundedMobileDateRange,
  extractBearerToken,
  mobileData,
  mobileError,
  mobileJson,
  mobileProfileIds,
} from "./mobile-api-contract";

export async function mobileApiGuard(request: Request, options?: {
  permissions?: AppPermission[];
  anyPermissions?: AppPermission[];
}) {
  const accessToken = extractBearerToken(request);
  if (!accessToken) {
    return {
      accessToken: null,
      account: null,
      denied: mobileError("authentication_required", "Inicia sesión en CIE Nexus para utilizar la aplicación móvil.", 401),
    };
  }
  const account = await getAccountFromAccessToken(accessToken);
  if (!account) {
    return {
      accessToken: null,
      account: null,
      denied: mobileError("invalid_or_inactive_session", "La sesión no es válida o la cuenta ya no está activa.", 401),
    };
  }
  const missingRequired = options?.permissions?.some((permission) => !hasPermission(account, permission));
  const missingAny = options?.anyPermissions?.length
    && !options.anyPermissions.some((permission) => hasPermission(account, permission));
  if (missingRequired || missingAny) {
    return {
      accessToken: null,
      account: null,
      denied: mobileError("permission_denied", "Tu rol no permite realizar esta acción desde la aplicación móvil.", 403),
    };
  }
  return { accessToken, account, denied: null };
}

export function mobileCapabilities(account: AppAccount) {
  return deriveMobileCapabilities(account.role, account.permissions);
}
