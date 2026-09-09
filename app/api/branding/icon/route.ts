import { eq } from "drizzle-orm";
import { getDb } from "../../../../db";
import { appSettings } from "../../../../db/schema";

type StoredObject = { arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } };
type Bucket = { get(key: string): Promise<StoredObject | null> };

export async function GET(request: Request) {
  try {
    const db = await getDb();
    const [settings] = await db.select({ institutionPhotoKey: appSettings.institutionPhotoKey }).from(appSettings).where(eq(appSettings.id, 1)).limit(1);
    if (!settings?.institutionPhotoKey) return Response.redirect(new URL("/favicon.svg", request.url), 307);
    const workers = await import("cloudflare:workers");
    const bucket = (workers.env as unknown as { BUCKET?: Bucket }).BUCKET;
    const object = await bucket?.get(settings.institutionPhotoKey);
    if (!object) return Response.redirect(new URL("/favicon.svg", request.url), 307);
    return new Response(await object.arrayBuffer(), {
      headers: {
        "Content-Type": object.httpMetadata?.contentType || "image/png",
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return Response.redirect(new URL("/favicon.svg", request.url), 307);
  }
}
