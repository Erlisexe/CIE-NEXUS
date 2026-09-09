import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { childDocuments, personnelProfiles } from "../../../db/schema";
import { apiAccountGuard, canAccessChild } from "../../../lib/access-control";

type StoredObject = { arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } };
type Bucket = {
  get(key: string): Promise<StoredObject | null>;
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  delete(key: string): Promise<void>;
};

const FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
};

async function bucketBinding() {
  const workers = await import("cloudflare:workers");
  const bucket = (workers.env as unknown as { BUCKET?: Bucket }).BUCKET;
  if (!bucket) throw new Error("El almacenamiento de documentos no está disponible.");
  return bucket;
}

async function scopedProfile(profileId: string, manage = false) {
  const { account, denied } = await apiAccountGuard({ permissions: [manage ? "children.manage" : "children.view"] });
  if (denied || !account) return { denied };
  const db = await getDb();
  const [profile] = await db.select().from(personnelProfiles).where(eq(personnelProfiles.id, profileId)).limit(1);
  if (!profile) return { denied: Response.json({ error: "No se encontró el niño." }, { status: 404 }) };
  if (!canAccessChild(account, profile)) return { denied: Response.json({ error: "Este niño no está dentro de tu alcance." }, { status: 403 }) };
  return { account, db, profile };
}

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!id) return Response.json({ error: "Documento no válido." }, { status: 400 });
    const db = await getDb();
    const [document] = await db.select().from(childDocuments).where(eq(childDocuments.id, id)).limit(1);
    if (!document) return Response.json({ error: "No se encontró el documento." }, { status: 404 });
    const scope = await scopedProfile(document.profileId);
    if (scope.denied) return scope.denied;
    const object = await (await bucketBinding()).get(document.storageKey);
    if (!object) return Response.json({ error: "El archivo ya no está disponible." }, { status: 404 });
    return new Response(await object.arrayBuffer(), {
      headers: {
        "Content-Type": object.httpMetadata?.contentType || document.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo descargar el documento." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const profileId = typeof form.get("profileId") === "string" ? String(form.get("profileId")) : "";
    const description = typeof form.get("description") === "string" ? String(form.get("description")).trim().slice(0, 500) : "";
    const file = form.get("file");
    if (!profileId || !(file instanceof File)) return Response.json({ error: "Selecciona un documento válido." }, { status: 400 });
    const extension = file.name.includes(".") ? file.name.split(".").pop()?.toLocaleLowerCase() || "" : "";
    if (!FILE_TYPES[extension]) return Response.json({ error: "Usa un archivo PDF, Word, Excel o CSV." }, { status: 400 });
    if (file.size <= 0 || file.size > 15 * 1024 * 1024) return Response.json({ error: "El documento debe pesar entre 1 byte y 15 MB." }, { status: 400 });
    const scope = await scopedProfile(profileId, true);
    if (scope.denied || !scope.db || !scope.account) return scope.denied;
    const id = crypto.randomUUID();
    const key = `children/${profileId}/${id}.${extension}`;
    const bucket = await bucketBinding();
    await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: FILE_TYPES[extension] } });
    try {
      const [document] = await scope.db.insert(childDocuments).values({
        id,
        profileId,
        uploadedByAccountId: scope.account.id,
        fileName: file.name.replace(/[\r\n]/g, " ").slice(0, 260),
        contentType: FILE_TYPES[extension],
        sizeBytes: file.size,
        storageKey: key,
        description,
      }).returning();
      return Response.json({ document: { ...document, storageKey: undefined, uploadedByAccountId: undefined } }, { status: 201 });
    } catch (error) {
      await bucket.delete(key).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo subir el documento." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) return Response.json({ error: "Documento no válido." }, { status: 400 });
    const db = await getDb();
    const [document] = await db.select().from(childDocuments).where(eq(childDocuments.id, id)).limit(1);
    if (!document) return Response.json({ error: "No se encontró el documento." }, { status: 404 });
    const scope = await scopedProfile(document.profileId, true);
    if (scope.denied) return scope.denied;
    await db.delete(childDocuments).where(eq(childDocuments.id, id));
    await (await bucketBinding()).delete(document.storageKey).catch(() => undefined);
    return Response.json({ deleted: true, id });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo eliminar el documento." }, { status: 500 });
  }
}
