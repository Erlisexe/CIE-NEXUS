export type SaveState = "saved" | "saving" | "error";

/** Coalesces snapshots, not observations: every newer snapshot contains all prior data. */
export function createLatestSaveQueue<T>(write: (snapshot: T) => Promise<void>, state: (value: SaveState, error?: Error) => void) {
  let pending: { value: T } | null = null;
  let running: Promise<void> | null = null;
  let lastError: Error | null = null;
  const drain = async () => {
    while (pending) {
      const snapshot = pending.value;
      pending = null;
      try { await write(snapshot); lastError = null; }
      catch (error) { lastError = error instanceof Error ? error : new Error("No se confirmó el guardado."); }
    }
    state(lastError ? "error" : "saved", lastError || undefined);
  };
  return {
    push(snapshot: T) {
      pending = { value: snapshot };
      state("saving");
      if (!running) running = drain().finally(() => { running = null; });
    },
    async flush() { while (running) await running; if (lastError) throw lastError; },
  };
}
