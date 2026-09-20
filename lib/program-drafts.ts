const MAX_DRAFT_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type StoredProgramDraft<T> = {
  version: 1;
  sourceUpdatedAt: string | null;
  savedAt: string;
  form: T;
};

export function programDraftStorageKey(accountId: string, programId: string | undefined, profileId: string | null) {
  const owner = encodeURIComponent(accountId || "anonymous");
  const subject = programId ? `program:${encodeURIComponent(programId)}` : `new:${encodeURIComponent(profileId || "unassigned")}`;
  return `cie-nexus:program-draft:v1:${owner}:${subject}`;
}

export function programFormSnapshot(form: unknown) {
  return JSON.stringify(form);
}

function validStoredDraft<T>(value: unknown): value is StoredProgramDraft<T> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const draft = value as Partial<StoredProgramDraft<T>>;
  if (draft.version !== 1 || typeof draft.savedAt !== "string" || !(draft.sourceUpdatedAt === null || typeof draft.sourceUpdatedAt === "string")) return false;
  if (!draft.form || typeof draft.form !== "object" || Array.isArray(draft.form)) return false;
  return Array.isArray((draft.form as { targets?: unknown }).targets);
}

export function readProgramDraft<T>(storage: DraftStorage, key: string, sourceUpdatedAt: string | null, now = Date.now()) {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const savedAt = validStoredDraft<T>(parsed) ? Date.parse(parsed.savedAt) : Number.NaN;
    if (!validStoredDraft<T>(parsed) || !Number.isFinite(savedAt) || parsed.sourceUpdatedAt !== sourceUpdatedAt || now - savedAt > MAX_DRAFT_AGE_MS) {
      storage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    try { storage.removeItem(key); } catch { /* Ignore storage policies and return no draft. */ }
    return null;
  }
}

export function writeProgramDraft<T>(storage: DraftStorage, key: string, form: T, sourceUpdatedAt: string | null, now = new Date()) {
  const draft: StoredProgramDraft<T> = { version: 1, sourceUpdatedAt, savedAt: now.toISOString(), form };
  storage.setItem(key, JSON.stringify(draft));
  return draft;
}

export function removeProgramDraft(storage: DraftStorage, key: string) {
  try { storage.removeItem(key); } catch { /* A storage policy must not trap the user in the editor. */ }
}
