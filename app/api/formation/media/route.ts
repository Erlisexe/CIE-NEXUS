import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { formationCourses } from "../../../../db/schema";
import { adminApiGuard, isAdminRequest } from "../../../../lib/admin-auth";
import { formationStorageKeys, normalizeFormationContent } from "../../../../lib/formation";

type StoredObject = { arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } };
type Bucket = {
  get(key: string): Promise<StoredObject | null>;
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
};

async function bucketBinding() {
  const workers = await import("cloudflare:workers");
  const bucket = (workers.env as unknown as { BUCKET?: Bucket }).BUCKET;
  if (!bucket) throw new Error("El almacenamiento de materiales no está disponible.");
  return bucket;
}

export async function POST(request: Request) {
  const denied = await adminApiGuard("training.manage");
  if (denied) return denied;
  try {
    const form = await request.formData();
    const courseId = typeof form.get("courseId") === "string" ? String(form.get("courseId")) : "";
    const file = form.get("file");
    if (!courseId || !(file instanceof File)) return Response.json({ error: "Selecciona un archivo válido." }, { status: 400 });
    const allowed = file.type.startsWith("image/") || file.type === "application/pdf" || file.type.startsWith("video/");
    if (!allowed) return Response.json({ error: "Usa una imagen, un PDF o un video compatible." }, { status: 400 });
    const maxSize = file.type.startsWith("video/") ? 80 * 1024 * 1024 : 25 * 1024 * 1024;
    if (file.size > maxSize) return Response.json({ error: file.type.startsWith("video/") ? "El video no puede superar 80 MB. Para videos más grandes, usa un enlace." : "El archivo no puede superar 25 MB." }, { status: 400 });
    const db = await getDb();
    const [course] = await db.select({ id: formationCourses.id }).from(formationCourses).where(eq(formationCourses.id, courseId)).limit(1);
    if (!course) return Response.json({ error: "No se encontró la formación." }, { status: 404 });
    const extension = file.name.includes(".") ? file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").slice(0, 8) : "bin";
    const key = `formation/${courseId}/${crypto.randomUUID()}.${extension || "bin"}`;
    const bucket = await bucketBinding();
    await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
    return Response.json({ media: { storageKey: key, fileName: file.name.slice(0, 260), mimeType: file.type } }, { status: 201 });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "No se pudo subir el archivo." }, { status: 500 }); }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const courseId = url.searchParams.get("courseId") || "";
    const key = url.searchParams.get("key") || "";
    if (!courseId || !key.startsWith(`formation/${courseId}/`)) return new Response("Material no válido", { status: 400 });
    const db = await getDb();
    const [course] = await db.select().from(formationCourses).where(eq(formationCourses.id, courseId)).limit(1);
    if (!course) return new Response("Material no encontrado", { status: 404 });
    const belongsToCourse = formationStorageKeys(normalizeFormationContent(JSON.parse(course.content || '{"chapters":[]}'))).includes(key);
    if (!belongsToCourse || (course.status !== "published" && !(await isAdminRequest("training.manage")))) return new Response("Material no disponible", { status: 403 });
    const object = await (await bucketBinding()).get(key);
    if (!object) return new Response("Material no encontrado", { status: 404 });
    return new Response(await object.arrayBuffer(), { headers: { "Content-Type": object.httpMetadata?.contentType || "application/octet-stream", "Cache-Control": course.status === "published" ? "public, max-age=3600" : "private, max-age=300" } });
  } catch { return new Response("No se pudo cargar el material", { status: 500 }); }
}
