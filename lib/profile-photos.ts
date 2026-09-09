import type { SupabaseClient } from "@supabase/supabase-js";

export const PROFILE_PHOTO_BUCKET = "profile-photos";
export const PROFILE_PHOTO_MAX_BYTES = 3 * 1024 * 1024;
export const PROFILE_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export type ProfilePhotoSubject = "child" | "account";

type ProfilePhotoRow = {
  id: string;
  subject_id: string;
  storage_path: string;
  created_at: string;
};

export async function signedProfilePhotoMap(
  supabase: SupabaseClient,
  subjectType: ProfilePhotoSubject,
  subjectIds: string[],
) {
  const uniqueIds = [...new Set(subjectIds.filter(Boolean))];
  const result = new Map<string, string>();
  if (!uniqueIds.length) return result;

  const { data, error } = await supabase
    .from("profile_photos")
    .select("id,subject_id,storage_path,created_at")
    .eq("subject_type", subjectType)
    .in("subject_id", uniqueIds)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);

  const latest = new Map<string, ProfilePhotoRow>();
  for (const raw of data || []) {
    const row = raw as ProfilePhotoRow;
    if (!latest.has(row.subject_id)) latest.set(row.subject_id, row);
  }
  const rows = [...latest.values()];
  if (!rows.length) return result;

  const { data: signed, error: signedError } = await supabase.storage
    .from(PROFILE_PHOTO_BUCKET)
    .createSignedUrls(rows.map((row) => row.storage_path), 60 * 60 * 6);
  if (signedError) throw new Error(signedError.message);

  const urlByPath = new Map((signed || [])
    .filter((item) => item.signedUrl)
    .map((item) => [item.path, item.signedUrl]));
  for (const row of rows) {
    const url = urlByPath.get(row.storage_path);
    if (url) result.set(row.subject_id, url);
  }
  return result;
}

export async function removeProfilePhotos(
  supabase: SupabaseClient,
  subjectType: ProfilePhotoSubject,
  subjectId: string,
) {
  const { data, error } = await supabase
    .from("profile_photos")
    .select("id,storage_path")
    .eq("subject_type", subjectType)
    .eq("subject_id", subjectId);
  if (error) throw new Error(error.message);
  const rows = (data || []) as Array<{ id: string; storage_path: string }>;
  if (!rows.length) return;

  const { error: storageError } = await supabase.storage
    .from(PROFILE_PHOTO_BUCKET)
    .remove(rows.map((row) => row.storage_path));
  if (storageError) throw new Error(storageError.message);

  const { error: deleteError } = await supabase
    .from("profile_photos")
    .delete()
    .in("id", rows.map((row) => row.id));
  if (deleteError) throw new Error(deleteError.message);
}
