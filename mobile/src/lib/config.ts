export const CIE_NEXUS_API_URL = (
  process.env.EXPO_PUBLIC_CIE_NEXUS_API_URL
  || "https://sistema-aba-clinico.silresaveuc.chatgpt.site"
).replace(/\/$/, "");

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || "https://qdjyfmibkzoexrurpyll.supabase.co";

export const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || "sb_publishable_9KFx7ckU5CIPTsmY30LcyQ_yfx3L2By";
