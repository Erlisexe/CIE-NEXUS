import { eq, sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { appSettings } from "../../../db/schema";
import { adminApiGuard } from "../../../lib/admin-auth";
import { apiAccountGuard } from "../../../lib/access-control";

type Bucket = {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  delete(key: string): Promise<void>;
};

async function getBucket() {
  const workers = await import("cloudflare:workers");
  const bucket = (workers.env as unknown as { BUCKET?: Bucket }).BUCKET;
  if (!bucket) throw new Error("El almacenamiento de imágenes no está disponible.");
  return bucket;
}

async function ensureSettings() {
  const db = await getDb();
  await db.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
  const [settings] = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
  return { db, settings };
}

function settingsError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  return message.includes("no such table") || message.startsWith("Failed query")
    ? "La personalización se habilitará al publicar esta actualización."
    : message;
}

function serialize(settings: typeof appSettings.$inferSelect) {
  const version = encodeURIComponent(settings.updatedAt);
  return {
    ...settings,
    institutionPhotoUrl: settings.institutionPhotoKey ? `/api/settings/image?kind=institution&v=${version}` : null,
    platformPhotoUrl: settings.platformPhotoKey ? `/api/settings/image?kind=platform&v=${version}` : null,
  };
}

export async function GET() {
  const { denied } = await apiAccountGuard(); if (denied) return denied;
  try {
    const { settings } = await ensureSettings();
    return Response.json({ settings: serialize(settings) });
  } catch (error) {
    return Response.json({ error: settingsError(error, "No se pudo cargar la personalización.") }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const denied = await adminApiGuard("settings.manage"); if (denied) return denied;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const pageName = typeof body.pageName === "string" ? body.pageName.trim() : "";
    if (!pageName || pageName.length > 60) {
      return Response.json({ error: "El nombre debe contener entre 1 y 60 caracteres." }, { status: 400 });
    }
    const { db } = await ensureSettings();
    const [settings] = await db.update(appSettings).set({ pageName, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(appSettings.id, 1)).returning();
    return Response.json({ settings: serialize(settings) });
  } catch (error) {
    return Response.json({ error: settingsError(error, "No se pudo guardar la personalización.") }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = await adminApiGuard("settings.manage"); if (denied) return denied;
  try {
    const form = await request.formData();
    const kind = form.get("kind");
    const file = form.get("file");
    if ((kind !== "institution" && kind !== "platform") || !(file instanceof File)) {
      return Response.json({ error: "Selecciona una imagen válida." }, { status: 400 });
    }
    if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(file.type)) {
      return Response.json({ error: "Usa una imagen PNG, JPG o WebP." }, { status: 400 });
    }
    if (file.size > 2 * 1024 * 1024) {
      return Response.json({ error: "La imagen no puede superar 2 MB." }, { status: 400 });
    }

    const { db, settings: current } = await ensureSettings();
    const bucket = await getBucket();
    const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const key = `branding/${kind}-${crypto.randomUUID()}.${extension}`;
    await bucket.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });

    const oldKey = kind === "institution" ? current.institutionPhotoKey : current.platformPhotoKey;
    const [settings] = await db.update(appSettings).set({
      ...(kind === "institution" ? { institutionPhotoKey: key } : { platformPhotoKey: key }),
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(appSettings.id, 1)).returning();
    if (oldKey && oldKey !== key) await bucket.delete(oldKey);
    return Response.json({ settings: serialize(settings) });
  } catch (error) {
    return Response.json({ error: settingsError(error, "No se pudo subir la imagen.") }, { status: 500 });
  }
}
