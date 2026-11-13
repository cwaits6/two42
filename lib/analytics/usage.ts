import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

export const USAGE_PERIODS = [7, 30, 90] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

const DEFAULT_PERIOD: UsagePeriod = 30;

/** A count below this is shown as "fewer than 5": in a small church it can point at one person. */
export const SMALLEST_SHOWN = 5;

export type UsageTotal = { kind: string; pattern: string; total: number };
export type RankedUsage = { pattern: string; shown: string };

export function usagePeriod(raw: string | string[] | undefined): UsagePeriod {
  const days = Number(raw);
  return USAGE_PERIODS.find((period) => period === days) ?? DEFAULT_PERIOD;
}

/** One church's totals per kind and pattern over the last `days` days. */
export function readUsageTotals(supabase: SupabaseClient<Database>, orgId: string, days: UsagePeriod) {
  return supabase.rpc("usage_count_totals", { _org_id: orgId, _days: days });
}

/** Totals added across churches per kind and pattern, before any are hidden. */
export function sumUsage(perChurch: UsageTotal[][]): UsageTotal[] {
  const sums = new Map<string, UsageTotal>();
  for (const row of perChurch.flat()) {
    const key = `${row.kind} ${row.pattern}`;
    const sum = sums.get(key);
    sums.set(key, { ...row, total: (sum?.total ?? 0) + row.total });
  }
  return [...sums.values()];
}

/**
 * Views and errors, most first. A hidden count sorts after every shown one,
 * by pattern, so its place in the list does not give its value away.
 */
export function rankUsage(rows: UsageTotal[]): { views: RankedUsage[]; errors: RankedUsage[] } {
  const rank = (kind: string): RankedUsage[] => {
    const ofKind = rows.filter((row) => row.kind === kind);
    const byPattern = (a: UsageTotal, b: UsageTotal) => a.pattern.localeCompare(b.pattern);
    const shown = ofKind
      .filter((row) => row.total >= SMALLEST_SHOWN)
      .sort((a, b) => b.total - a.total || byPattern(a, b))
      .map((row) => ({ pattern: row.pattern, shown: row.total.toLocaleString("en-US") }));
    const hidden = ofKind
      .filter((row) => row.total < SMALLEST_SHOWN)
      .sort(byPattern)
      .map((row) => ({ pattern: row.pattern, shown: "fewer than 5" }));
    return [...shown, ...hidden];
  };
  return { views: rank("view"), errors: rank("error") };
}
