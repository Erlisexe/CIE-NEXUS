import { CIE_NEXUS_API_URL } from "./config";
import type { ApiEnvelope, ApiFailure } from "../types";

export class MobileApiError extends Error {
  constructor(message: string, readonly code = "mobile_api_error", readonly status = 0) {
    super(message);
  }
}

export async function mobileGet<T>(path: string, accessToken: string) {
  return mobileRequest<T>(path, accessToken);
}

export async function mobilePost<T>(path: string, accessToken: string, data: unknown) {
  return mobileRequest<T>(path, accessToken, data);
}

async function mobileRequest<T>(path: string, accessToken: string, data?: unknown): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
  const response = await fetch(`${CIE_NEXUS_API_URL}/api/mobile/v1${path}`, {
    signal: controller.signal,
    method: data === undefined ? "GET" : "POST",
    body: data === undefined ? undefined : JSON.stringify(data),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
    },
  });
  const body = await response.json().catch(() => ({})) as ApiEnvelope<T> | ApiFailure;
  if (!response.ok || !("data" in body)) {
    const failure = body as ApiFailure;
    throw new MobileApiError(
      failure.error?.message || "No se pudo conectar con CIE Nexus.",
      failure.error?.code,
      response.status,
    );
  }
  return body.data;
  } catch (error) {
    if (error instanceof MobileApiError) throw error;
    throw new MobileApiError("Sin conexión confirmada. Tus registros locales se conservan.", "network_unavailable", 0);
  } finally { clearTimeout(timeout); }
}
