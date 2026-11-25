import { failureMessage } from "@/lib/errorCopy";

// The church records routes answer these statuses with a sentence written for a church admin.
const SPOKEN = new Set([400, 409, 502]);

export async function call(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: res.ok && data !== null, status: res.status, data };
}

export function errorText(action: string, status: number, data: Record<string, unknown> | null): string {
  return SPOKEN.has(status) && typeof data?.error === "string" ? data.error : failureMessage(action, status);
}
