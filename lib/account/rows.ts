import { logError, stepOf } from "@/lib/log";

export function rowsOf<T>(read: { data: unknown; error: { code?: string } | null }, step: string): T[] {
  // The step and code only: a PostgrestError's details echo row content.
  if (read.error) logError("Account data read failed", read.error, { step: stepOf(step) });
  if (read.error) throw new Error(`${step}: code=${read.error.code}`);
  return (read.data ?? []) as T[];
}
