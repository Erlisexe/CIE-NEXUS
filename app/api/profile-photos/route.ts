import { eq } from "drizzle-orm";
import { getDb } from "../../../db";
import { personnelProfiles } from "../../../db/schema";
import {
  apiAccountGuard,
  canAccessChild,
  canViewTeamRole,
  hasPermission,
  type AppAccount,
  type AppRole,
} from "../../../lib/access-control";
import {
  PROFILE_PHOTO_BUCKET,
  PROFILE_PHOTO_MAX_BYTES,
  PROFILE_PHOTO_TYPES,
  removeProfilePhotos,
  signedProfilePhotoMap,
  type ProfilePhotoSubject,
} from "../../../lib/profile-photos";
import { createSupabaseServerClient } from "../../../lib/supabase/server";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function textValue(value: FormDataEntryValue | string | null, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function authorizeSubject(account: AppAccount, subjectType: ProfilePhotoSubject, subjectId: string, mode: "view" | "manage") {
  if (subjectType === "child") {
    const permission = mode === "manage" ? "children.manage" : "children.view";
    if (!hasPermission(account, permission)) return { error: "Tu rol no permite acceder a esta fotografía.", status: 403 as const };
    const db = await getDb();
    const [profile] = await db.select().from(personnelProfiles).where(eq(personnelProfiles.id, subjectId)).limit(1);
    if (!profile) return { error: "No se encontró el niño.", status: 404 as const };
    if (!canAccessChild(account, profile)) return { error: "Este niño no está dentro de tu alcance.", status: 403 as const };
    return { subjectSite: profile.site };
  }

  const supabase = await createSupabaseServerClient();
  const { data: target, error } = await supabase
    .from("app_accounts")
    .select("id,role")
    .eq("id", subjectId)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 as const };
  if (!target) return { error: "No se encontró la cuenta.", status: 404 as const };
  const targetRole = target.role as AppRole;
  const allowed = mode === "manage"
    ? account.id === subjectId || hasPermission(account, "accounts.manage")
    : account.id === subjectId || hasPermission(account, "accounts.manage") || canViewTeamRole(account.role, targetRole);
  return allowed ? { subjectSite: null } : { error: "No puedes acceder a la fotografía de esta cuenta.", status: 403 as const };
}

function subjectFromUrl(request: Request): { subjectType: ProfilePhotoSubject | null; subjectId: string } {
  const params = new URL(request.url).searchParams;
  const subjectType = params.get("subjectType") === "child" ? "child" : params.get("subjectType") === "account" ? "account" : null;
  return { subjectType, subjectId: textValue(params.get("subjectId"), 160) };
}

export async function GET(request: Request) {
  const { account, denied } = await apiAccountGuard();
  if (denied || !account) return denied;
  const { subjectType, subjectId } = subjectFromUrl(request);
  if (!subjectType || !subjectId) return Response.json({ error: "Perfil no válido." }, { status: 400 });

  const authorization = await authorizeSubject(account, subjectType, subjectId, "view");
  if ("error" in authorization) return Response.json({ error: authorization.error }, { status: authorization.status });
  try {
    const supabase = await createSupabaseServerClient();
    const urls = await signedProfilePhotoMap(supabase, subjectType, [subjectId]);
    return Response.json({ photoUrl: urls.get(subjectId) || null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo cargar la fotografía." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { account, denied } = await apiAccountGuard();
  if (denied || !account) return denied;
  try {
    const form = await request.formData();
    const subjectType = form.get("subjectType") === "child" ? "child" : form.get("subjectType") === "account" ? "account" : null;
    const subjectId = textValue(form.get("subjectId"), 160);
    const file = form.get("file");
    if (!subjectType || !subjectId || !(file instanceof File)) return Response.json({ error: "Selecciona un perfil y una imagen." }, { status: 400 });
    if (!PROFILE_PHOTO_TYPES.has(file.type)) return Response.json({ error: "Usa una imagen JPG, PNG o WebP." }, { status: 415 });
    if (!file.size || file.size > PROFILE_PHOTO_MAX_BYTES) return Response.json({ error: "La fotografía debe pesar como máximo 3 MB." }, { status: 413 });

    const authorization = await authorizeSubject(account, subjectType, subjectId, "manage");
    if ("error" in authorization) return Response.json({ error: authorization.error }, { status: authorization.status });

    const supabase = await createSupabaseServerClient();
    const { data: previous, error: previousError } = await supabase
      .from("profile_photos")
      .select("id,storage_path")
      .eq("subject_type", subjectType)
      .eq("subject_id", subjectId);
    if (previousError) throw new Error(previousError.message);

    const photoId = crypto.randomUUID();
    const storagePath = `${subjectType}/${subjectId}/${photoId}.${EXTENSIONS[file.type]}`;
    const { error: metadataError } = await supabase.from("profile_photos").insert({
      id: photoId,
      subject_type: subjectType,
      subject_id: subjectId,
      subject_site: authorization.subjectSite,
      storage_path: storagePath,
      original_name: textValue(file.name, 240) || `fotografia.${EXTENSIONS[file.type]}`,
      content_type: file.type,
      size_bytes: file.size,
      uploaded_by_account_id: account.id,
    });
    if (metadataError) throw new Error(metadataError.message);

    const { error: uploadError } = await supabase.storage.from(PROFILE_PHOTO_BUCKET).upload(storagePath, file, {
      cacheControl: "21600",
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) {
      await supabase.from("profile_photos").delete().eq("id", photoId);
      throw new Error(uploadError.message);
    }

    const oldRows = (previous || []) as Array<{ id: string; storage_path: string }>;
    if (oldRows.length) {
      const { error: removeError } = await supabase.storage.from(PROFILE_PHOTO_BUCKET).remove(oldRows.map((row) => row.storage_path));
      if (!removeError) await supabase.from("profile_photos").delete().in("id", oldRows.map((row) => row.id));
    }

    const urls = await signedProfilePhotoMap(supabase, subjectType, [subjectId]);
    return Response.json({ photoUrl: urls.get(subjectId) || null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo guardar la fotografía." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { account, denied } = await apiAccountGuard();
  if (denied || !account) return denied;
  const { subjectType, subjectId } = subjectFromUrl(request);
  if (!subjectType || !subjectId) return Response.json({ error: "Perfil no válido." }, { status: 400 });
  const authorization = await authorizeSubject(account, subjectType, subjectId, "manage");
  if ("error" in authorization) return Response.json({ error: authorization.error }, { status: authorization.status });
  try {
    const supabase = await createSupabaseServerClient();
    await removeProfilePhotos(supabase, subjectType, subjectId);
    return Response.json({ removed: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No se pudo eliminar la fotografía." }, { status: 500 });
  }
}
