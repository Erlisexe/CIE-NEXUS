import { getRawDb } from "../../../../../db";
import { mobileApiGuard, mobileData, mobileError } from "../../../../../lib/mobile-api";
import { CollectionError } from "../../../../../lib/mobile-collection";
import { prepareMobileCollection, syncMobileCollection } from "../../../../../lib/mobile-collection-server";

export async function GET(request: Request) {
  const { account, denied } = await mobileApiGuard(request, { anyPermissions: ["sessions.record", "sessions.manage"] });
  if (denied || !account) return denied;
  try { const p = new URL(request.url).searchParams; return mobileData(await prepareMobileCollection(await getRawDb(), account, p.get("profileId") || "", p.get("appointmentId") || null)); }
  catch (e) { return e instanceof CollectionError ? mobileError(e.code, e.message, e.status) : mobileError("preparation_unavailable", "No se pudo preparar la sesión. Revisa la conexión.", 503); }
}
export async function POST(request: Request) {
  const { account, denied } = await mobileApiGuard(request, { anyPermissions: ["sessions.record", "sessions.manage"] });
  if (denied || !account) return denied;
  try {
    if (Number(request.headers.get("content-length")) > 2000000) return mobileError("session_too_large", "El registro supera el tamaño admitido. Conserva la sesión y solicita revisión.", 413);
    const reader = request.body?.getReader();
    if (!reader) return mobileError("invalid_collection", "La solicitud no contiene una sesión.", 400);
    const decoder = new TextDecoder();
    let body = "", size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 2000000) { await reader.cancel(); return mobileError("session_too_large", "El registro supera el tamaño admitido. Conserva la sesión y solicita revisión.", 413); }
      body += decoder.decode(part.value, { stream: true });
    }
    body += decoder.decode();
    let payload: unknown; try { payload = JSON.parse(body); } catch { return mobileError("invalid_collection", "El registro no tiene un formato válido.", 400); }
    return mobileData(await syncMobileCollection(await getRawDb(), account, payload));
  } catch (e) { return e instanceof CollectionError ? mobileError(e.code, e.message, e.status) : mobileError("sync_unavailable", "No se confirmó la sincronización. Conserva los datos y reintenta.", 503); }
}
