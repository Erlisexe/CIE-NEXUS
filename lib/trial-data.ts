export const PROMPT_LEVELS = [
  { id: "independent", label: "Independiente" },
  { id: "gesture", label: "Gestual" },
  { id: "verbal", label: "Verbal" },
  { id: "model", label: "Modelo" },
  { id: "partial_physical", label: "Física parcial" },
  { id: "full_physical", label: "Física total" },
] as const;

export type PromptLevelId = typeof PROMPT_LEVELS[number]["id"];

export type TrialDetail = {
  value: 0 | 1;
  at?: string;
  promptLevel?: PromptLevelId;
};

const promptIds = new Set<string>(PROMPT_LEVELS.map((item) => item.id));

export function promptLevelLabel(value: unknown) {
  return PROMPT_LEVELS.find((item) => item.id === value)?.label || "Sin nivel documentado";
}

/**
 * Keeps only trial metadata that was actually recorded. Missing historical
 * timestamps or prompt levels remain missing and are never inferred.
 */
export function normalizeTrialDetails(value: unknown, trials: Array<0 | 1>): TrialDetail[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, trials.length).map((raw, index) => {
    if (!raw || typeof raw !== "object") return { value: trials[index]! };
    const item = raw as Record<string, unknown>;
    const trialValue = item.value === 1 || item.value === true || item.value === "1"
      ? 1 as const
      : item.value === 0 || item.value === false || item.value === "0"
        ? 0 as const
        : trials[index];
    if (trialValue !== 0 && trialValue !== 1) return { value: trials[index]! };
    const at = typeof item.at === "string" && Number.isFinite(Date.parse(item.at)) ? item.at : undefined;
    const promptLevel = typeof item.promptLevel === "string" && promptIds.has(item.promptLevel)
      ? item.promptLevel as PromptLevelId
      : undefined;
    return { value: trialValue, ...(at ? { at } : {}), ...(promptLevel ? { promptLevel } : {}) };
  });
}
