export const MOBILE_API_VERSION = "v1";
export const MOBILE_SCOPE_POLICY = "assigned_or_own_appointment";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function extractBearerToken(request: Request) {
  const value = request.headers.get("authorization")?.trim() || "";
  const match = /^Bearer\s+([^\s]+)$/i.exec(value);
  const token = match?.[1] || "";
  return token.length >= 20 && token.length <= 8192 ? token : null;
}

export function mobileJson(data: unknown, init: ResponseInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store, private");
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("X-CIE-Nexus-API-Version", MOBILE_API_VERSION);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function mobileData<T>(data: T) {
  return mobileJson({
    data,
    meta: {
      apiVersion: MOBILE_API_VERSION,
      serverTime: new Date().toISOString(),
    },
  });
}

export function mobileError(code: string, message: string, status: number) {
  return mobileJson({ error: { code, message } }, { status });
}

export function mobileProfileIds(account: { assignedProfileIds: string[] }, ownAppointmentProfileIds: string[] = []) {
  return new Set([...account.assignedProfileIds, ...ownAppointmentProfileIds].filter(Boolean));
}

export function deriveMobileCapabilities(role: string, permissions: string[]) {
  const allowed = (permission: string) => role === "direccion_clinica" || permissions.includes(permission);
  return {
    viewChildren: allowed("children.view"),
    viewPrograms: allowed("programs.view") || allowed("programs.manage") || allowed("sessions.record"),
    viewGraphs: allowed("graphs.view") || allowed("graphs.manage"),
    viewCalendar: allowed("calendar.view") || allowed("calendar.manage"),
    recordSessions: allowed("sessions.record") || allowed("sessions.manage"),
    recordAbc: allowed("abc.record") || allowed("abc.manage"),
  };
}

function shiftedDate(value: Date, days: number) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function boundedMobileDateRange(fromValue: string | null, toValue: string | null, now = new Date()) {
  const fallbackFrom = shiftedDate(now, -7);
  const from = fromValue && isCalendarDate(fromValue) ? fromValue : fallbackFrom;
  const fallbackTo = shiftedDate(new Date(`${from}T00:00:00.000Z`), 60);
  const requestedTo = toValue && isCalendarDate(toValue) ? toValue : fallbackTo;
  const maximumTo = shiftedDate(new Date(`${from}T00:00:00.000Z`), 93);
  const to = requestedTo > maximumTo ? maximumTo : requestedTo < from ? from : requestedTo;
  return { from, to };
}
