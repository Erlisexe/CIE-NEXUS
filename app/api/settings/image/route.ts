import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings } from "../../../../db/schema";
import { apiAccountGuard } from "../../../../lib/access-control";

type StoredObject = { arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } };
type Bucket = { get(key: string): Promise<StoredObject | null> };

export async function GET(request: Request) {
  const { denied } = await apiAccountGuard(); if (denied) return denied;
  try {
    const kind = new URL(request.url).searchParams.get("kind");
    if (kind !== "institution" && kind !== "platform") return new Response("Tipo no válido", { status: 400 });
    const db = await getDb();
    const [settings] = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
    const key = kind === "institution" ? settings?.institutionPhotoKey : settings?.platformPhotoKey;
    if (!key) return new Response("Imagen no encontrada", { status: 404 });

    const workers = await import("cloudflare:workers");
    const bucket = (workers.env as unknown as { BUCKET?: Bucket }).BUCKET;
    const object = await bucket?.get(key);
    if (!object) return new Response("Imagen no encontrada", { status: 404 });
    return new Response(await object.arrayBuffer(), {
      headers: {
        "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return new Response("No se pudo cargar la imagen", { status: 500 });
  }
}
