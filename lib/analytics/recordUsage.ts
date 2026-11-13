import { createClient } from "@/lib/supabase/client";
import { pagePattern } from "@/lib/analytics/pagePattern";

/** The kinds the database accepts; usageKinds.test.ts holds the migration's lists equal to this. */
export const USAGE_KINDS = ["view", "error"] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

const WRITE_TIMEOUT_MS = 5000;

// One page view counts at most one error, however many of its sections fail.
// A view of another address starts a new page view.
let errorCountedFor: string | null = null;

/**
 * Adds one to today's count for the page's route pattern in the signed-in
 * person's church. Only the pattern and the kind leave the browser. Callers
 * never await it; it never throws.
 */
export async function recordUsage(kind: UsageKind, pathname: string): Promise<void> {
  if (kind === "error") {
    if (errorCountedFor === pathname) return;
    errorCountedFor = pathname;
  } else if (errorCountedFor !== pathname) {
    errorCountedFor = null;
  }
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
