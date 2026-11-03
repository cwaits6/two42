import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { savePrayerRetention } from "./PrayerRetentionSettings";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

type Result = { data: unknown[] | null; error: { message: string } | null };

function client(result: Result, calls: Record<string, unknown>) {
  return {
    from: (table: string) => ({
      update: (values: unknown) => ({
        eq: (column: string, value: unknown) => ({
          select: async () => {
            Object.assign(calls, { table, values, column, value });
            return result;
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient<Database>;
}

describe("savePrayerRetention", () => {
  it("writes the months for a period, on the caller's own org", async () => {
    const calls: Record<string, unknown> = {};
    const ok = await savePrayerRetention(client({ data: [{}], error: null }, calls), "org-1", 12);
    expect(ok).toBe(true);
    expect(calls).toEqual({
      table: "organizations",
      values: { prayer_request_retention_months: 12 },
      column: "id",
      value: "org-1",
    });
  });

  it("writes null to turn it off", async () => {
    const calls: Record<string, unknown> = {};
    await savePrayerRetention(client({ data: [{}], error: null }, calls), "org-1", "off");
    expect(calls.values).toEqual({ prayer_request_retention_months: null });
  });

  it("is not a save when RLS filtered the row out", async () => {
    expect(await savePrayerRetention(client({ data: [], error: null }, {}), "org-1", 6)).toBe(false);
  });

  it("is not a save on an error", async () => {
    const failed = client({ data: null, error: { message: "refused" } }, {});
    expect(await savePrayerRetention(failed, "org-1", 6)).toBe(false);
  });
});
