"use client";
/* eslint-disable @next/next/no-img-element */

import { Camera, LoaderCircle } from "lucide-react";
import type { ProfilePhotoSubject } from "../../lib/profile-photos";

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "PF";
}

export async function uploadProfilePhoto(subjectType: ProfilePhotoSubject, subjectId: string, file: File) {
  const form = new FormData();
  form.set("subjectType", subjectType);
  form.set("subjectId", subjectId);
  form.set("file", file);
  const response = await fetch("/api/profile-photos", { method: "POST", body: form });
  const payload = await response.json() as { photoUrl?: string | null; error?: string };
  if (!response.ok) throw new Error(payload.error || "No se pudo guardar la fotografía.");
  return payload.photoUrl || null;
}

export default function ProfilePhoto({
  name,
  src,
  avatarClassName,
  editable = false,
  uploading = false,
  onFile,
  label = "Cambiar fotografía",
}: {
  name: string;
  src?: string | null;
  avatarClassName: string;
  editable?: boolean;
  uploading?: boolean;
  onFile?: (file: File) => void;
  label?: string;
}) {
  return <div className={`profile-photo-frame ${editable ? "is-editable" : ""}`}>
    <span className={avatarClassName}>{src ? <img src={src} alt={`Fotografía de ${name}`}/> : initials(name)}</span>
    {editable && <label className="profile-photo-control" aria-label={label} title={label}>
      {uploading ? <LoaderCircle className="spin" size={14}/> : <Camera size={14}/>}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) onFile?.(file); event.currentTarget.value = ""; }}/>
    </label>}
  </div>;
}
