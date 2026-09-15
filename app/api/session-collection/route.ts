import { getRawDb } from "../../../db";
import { apiAccountGuard } from "../../../lib/access-control";
import { CollectionError } from "../../../lib/mobile-collection";
import { syncWebCollection } from "../../../lib/mobile-collection-server";
import { discardWebCollectionDraft, prepareWebCollection, saveWebCollectionDraft, startWebCollection } from "../../../lib/web-session-collection-server";

function errorResponse(error: unknown) {
  if (error instanceof CollectionError) return Response.json({ error: error.message, code: error.code }, { status: error.status });
  return Response.json({ error: "No se pudo completar la operación de la sesión. Los datos conservados no fueron eliminados." }, { status: 500 });
}

async function boundedJson(request: Request) {
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > 2_000_000) throw new CollectionError("session_too_large", "El registro supera el tamaño admitido. Cierra la sesión y solicita revisión.", 413);
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 2_000_000) throw new CollectionError("session_too_large", "El registro supera el tamaño admitido. Cierra la sesión y solicita revisión.", 413);
  try { return JSON.parse(text) as Record<string, unknown>; }
  catch { throw new CollectionError("invalid_json", "La sesión no tiene un formato válido.", 400); }
}

export async function GET(request: Request) {
  const { account, denied } = await apiAccountGuard({ anyPermissions: ["sessions.record", "sessions.manage"] });
  if (denied || !account) return denied;
  try {
    const params = new URL(request.url).searchParams;
    return Response.json(await prepareWebCollection(await getRawDb(), account, params.get("profileId")?.trim() || "", params.get("appointmentId")?.trim() || null));
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  const { account, denied } = await apiAccountGuard({ anyPermissions: ["sessions.record", "sessions.manage"] });
  if (denied || !account) return denied;
  try {
    const body = await boundedJson(request);
    if (body.action === "start") return Response.json(await startWebCollection(await getRawDb(), account, body), { status: 201 });
    if (body.action === "close") return Response.json({ receipt: await syncWebCollection(await getRawDb(), account, body.payload) }, { status: 201 });
    return Response.json({ error: "Acción de sesión no reconocida." }, { status: 400 });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request) {
  const { account, denied } = await apiAccountGuard({ anyPermissions: ["sessions.record", "sessions.manage"] });
  if (denied || !account) return denied;
  try {
    const body = await boundedJson(request);
    return Response.json(await saveWebCollectionDraft(await getRawDb(), account, body.draft));
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request) {
  const { account, denied } = await apiAccountGuard({ anyPermissions: ["sessions.record", "sessions.manage"] });
  if (denied || !account) return denied;
  try {
    const body = await boundedJson(request);
    return Response.json(await discardWebCollectionDraft(await getRawDb(), account, typeof body.id === "string" ? body.id : ""));
  } catch (error) { return errorResponse(error); }
}
