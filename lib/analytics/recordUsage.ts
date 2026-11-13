import { createClient } from "@/lib/supabase/client";
import { pagePattern } from "@/lib/analytics/pagePattern";

export type UsageKind = "view" | "error";

const WRITE_TIMEOUT_MS = 5000;

/**
 * Adds one to today's count for the page's route pattern in the signed-in
 * person's church. Only the pattern and the kind leave the browser. Callers
 * never await it; it never throws.
 */
export async function recordUsage(kind: UsageKind, pathname: string): Promise<void> {
  const pattern = pagePattern(pathname);
  if (!pattern) return;
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    if (!data.session) return;
    await supabase
      .rpc("usage_count_record", { _pattern: pattern, _kind: kind })
      .abortSignal(AbortSignal.timeout(WRITE_TIMEOUT_MS));
  } catch {
    // Deliberately quiet, errors included: a count is never worth a broken
    // page, a browser log reaches no operator, and while the database lacks
    // the function every page would otherwise report it.
  }
}
