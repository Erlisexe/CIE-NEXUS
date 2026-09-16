import * as SQLite from "expo-sqlite";
import * as SecureStore from "expo-secure-store";
import * as Crypto from "expo-crypto";
import type { CollectionDraft } from "../../../lib/mobile-collection.ts";

export class ClinicalVault {
  constructor(private db: SQLite.SQLiteDatabase) {}
  cached<T>(key: string): T | null {
    const row = this.db.getFirstSync<{ body: string }>("SELECT body FROM cache WHERE key = ?", key);
    return row ? JSON.parse(row.body) as T : null;
  }
  cache(key: string, value: unknown) {
    this.db.runSync("INSERT INTO cache(key, body) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body", key, JSON.stringify(value));
  }
  drafts(): CollectionDraft[] {
    return this.db.getAllSync<{ body: string }>("SELECT body FROM drafts ORDER BY started_at").map((r) => JSON.parse(r.body) as CollectionDraft);
  }
  save(draft: CollectionDraft) {
    // One synchronous, durable statement. UI acknowledges a response only after it
    // succeeds; a process exit cannot expose a partly written session snapshot.
    this.db.runSync("INSERT INTO drafts(id, started_at, status, body) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, body = excluded.body",
      draft.id, draft.startedAt, draft.status, JSON.stringify(draft));
  }
  removeDraft(id: string) { this.db.runSync("DELETE FROM drafts WHERE id = ?", id); }
  clearSyncedAndCache() {
    this.db.withTransactionSync(() => { this.db.runSync("DELETE FROM drafts WHERE status = 'synced'"); this.db.runSync("DELETE FROM cache"); });
  }
  clearCache() { this.db.runSync("DELETE FROM cache"); }
  forget(key: string) { this.db.runSync("DELETE FROM cache WHERE key = ?", key); }
}
const opened = new Map<string, Promise<ClinicalVault>>();
export function openClinicalVault(userId: string): Promise<ClinicalVault> {
  if (!/^[a-zA-Z0-9_-]+$/.test(userId)) return Promise.reject(new Error("La cuenta no tiene un identificador válido."));
  let promise = opened.get(userId);
  if (!promise) {
    promise = (async () => {
      const keyName = `cie.clinical.v1.${userId}`;
      let key = await SecureStore.getItemAsync(keyName);
      if (!key) {
        key = Array.from(await Crypto.getRandomBytesAsync(32), (b) => b.toString(16).padStart(2, "0")).join("");
        await SecureStore.setItemAsync(keyName, key, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
      }
      if (!/^[0-9a-f]{64}$/.test(key)) throw new Error("No se pudo abrir la protección de los registros locales.");
      const db = SQLite.openDatabaseSync(`cie-clinical-${userId}.db`);
      db.execSync(`PRAGMA key = "x'${key}'"`);
      if (!db.getFirstSync<{ cipher_version: string }>("PRAGMA cipher_version")?.cipher_version) {
        db.closeSync(); throw new Error("Este instalador no incluye el almacenamiento clínico cifrado. Instala la versión Android de CIE Nexus.");
      }
      db.execSync("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY NOT NULL, started_at TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL);");
      return new ClinicalVault(db);
    })();
    opened.set(userId, promise);
    void promise.catch(() => opened.delete(userId));
  }
  return promise;
}
