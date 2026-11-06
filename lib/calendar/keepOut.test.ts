import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loggedLines } from "@/lib/log/testing";
import { calendarSharingByGroup } from "./keepOut";

const ORG = "a0000000-0000-4000-8000-000000000001";

afterEach(() => vi.restoreAllMocks());

describe("calendarSharingByGroup", () => {
  it("logs a failed read's code before throwing, since the thrown Error carries none", async () => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = { data: null, error: { code: "PGRST301", message: "JWT expired" } };
    const query = { select: () => query, eq: () => query, in: async () => result };
    const supabase = { from: () => query } as unknown as SupabaseClient;

    await expect(calendarSharingByGroup(supabase, ORG, ["g1"])).rejects.toThrow();
    expect(loggedLines(logged)).toEqual([
      expect.objectContaining({ step: "group_settings", code: "PGRST301", ids: { org: ORG } }),
    ]);
  });
});
