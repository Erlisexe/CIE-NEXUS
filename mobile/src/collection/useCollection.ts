import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import type { Session } from "@supabase/supabase-js";
import { randomUUID } from "expo-crypto";
import { collectionPayload, stopCollectionClocks, type CollectionDraft, type CollectionReceipt } from "../../../lib/mobile-collection.ts";
import { mobilePost, MobileApiError } from "../lib/api";
import { supabase } from "../lib/supabase";
import { openClinicalVault, type ClinicalVault } from "./vault";

export function useCollection(session: Session) {
  const [vault, setVault] = useState<ClinicalVault | null>(null);
  const [drafts, setDrafts] = useState<CollectionDraft[]>([]);
  const [storageError, setStorageError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const draftRef = useRef(drafts);
  const busy = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    void openClinicalVault(session.user.id).then((db) => {
      if (!active.current) return;
      const saved = db.drafts().map((draft) => {
        if (draft.status !== "active") return draft;
        const recovered = stopCollectionClocks(draft, draft.lastActiveAt || draft.startedAt, randomUUID);
        db.save(recovered); return recovered;
      });
      draftRef.current = saved; setDrafts(saved); setVault(db);
    }).catch((e: unknown) => setStorageError(e instanceof Error ? e.message : "No se pudo abrir el guardado local."));
    return () => { active.current = false; };
  }, [session.user.id]);

  const save = useCallback((draft: CollectionDraft) => {
    if (!vault) throw new Error("El guardado local todavía no está disponible.");
    try {
      draft = { ...draft, lastActiveAt: new Date().toISOString() };
      vault.save(draft);
      const next = draftRef.current.some((d) => d.id === draft.id) ? draftRef.current.map((d) => d.id === draft.id ? draft : d) : [...draftRef.current, draft];
      draftRef.current = next; setDrafts(next); setStorageError("");
    } catch (e) { setStorageError("No se pudo guardar en el teléfono. No cierres la aplicación; libera espacio y vuelve a intentar."); throw e; }
  }, [vault]);

  const discard = useCallback((id: string) => {
    if (!vault) throw new Error("El guardado local todavía no está disponible.");
    const draft = draftRef.current.find((item) => item.id === id);
    if (!draft || draft.status !== "active") throw new Error("Solo se puede descartar una sesión activa y vacía.");
    try {
      vault.removeDraft(id);
      const next = draftRef.current.filter((item) => item.id !== id);
      draftRef.current = next;
      setDrafts(next);
      setStorageError("");
    } catch (e) {
      setStorageError("No se pudo descartar el borrador vacío.");
      throw e;
    }
  }, [vault]);

  const synchronize = useCallback(async () => {
    if (!vault || busy.current || !active.current || AppState.currentState !== "active") return;
    busy.current = true; setSyncing(true);
    try {
      const auth = await supabase.auth.getSession();
      const accessToken = auth.data.session?.access_token || session.access_token;
      const blockedProfiles = new Set<string>();
      for (const original of [...draftRef.current].sort((a,b) => a.startedAt.localeCompare(b.startedAt))) {
        if (!active.current) break;
        const draft = draftRef.current.find((d) => d.id === original.id)!;
        if (draft.status === "conflict" || draft.status === "active") blockedProfiles.add(draft.preparation.profile.id);
        if (draft.status !== "pending" || blockedProfiles.has(draft.preparation.profile.id)) continue;
        try {
          const receipt = await mobilePost<CollectionReceipt>("/collection", accessToken, collectionPayload(draft));
          if (receipt.id !== draft.id || receipt.status !== "closed") throw new MobileApiError("El servidor no confirmó esta sesión.", "receipt_mismatch", 503);
          save({ ...draft, status: "synced", syncedAt: new Date().toISOString(), syncError: "", syncErrorCode: "" });
        } catch (e) {
          const apiError = e instanceof MobileApiError ? e : new MobileApiError("No se pudo confirmar la sincronización.");
          const retry = !apiError.status || apiError.status === 401 || apiError.status === 408 || apiError.status === 429 || apiError.status >= 500;
          save({ ...draft, status: retry ? "pending" : "conflict", syncError: apiError.message, syncErrorCode: apiError.code });
          // Do not apply a later session for the same child ahead of unconfirmed data.
          break;
        }
      }
    } catch {
      if (active.current) setStorageError("No se pudo actualizar el estado local. Conserva la aplicación abierta y vuelve a intentar.");
    } finally { busy.current = false; if (active.current) setSyncing(false); }
  }, [vault, save, session.access_token]);
  useEffect(() => {
    if (!vault) return;
    const timer = setInterval(() => { void synchronize(); }, 20000);
    const appState = AppState.addEventListener("change", (state) => { if (state === "active") void synchronize(); });
    void synchronize();
    return () => { clearInterval(timer); appState.remove(); };
  }, [vault, synchronize]);
  return { vault, drafts, storageError, syncing, save, discard, synchronize };
}
export type CollectionController = ReturnType<typeof useCollection>;
