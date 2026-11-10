import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loggedLines } from "@/lib/log/testing";
import { calendarSharingByGroup } from "./keepOut";

const ORG = "a0000000-0000-4000-8000-000000000001";
const MARKER = "ada.lovelace@example.test";

afterEach(() => vi.restoreAllMocks());

describe("calendarSharingByGroup", () => {
  it("logs a failed read's code before throwing fixed text, since the thrown Error carries none", async () => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = { data: null, error: { code: "PGRST301", message: MARKER } };
    const query = { select: () => query, eq: () => query, in: async () => result };
    const supabase = { from: () => query } as unknown as SupabaseClient;

    const thrown = await calendarSharingByGroup(supabase, ORG, ["g1"]).catch((e: Error) => e);

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("Failed to load calendar sharing settings");
    expect((thrown as Error).message).not.toContain(MARKER);
    expect(loggedLines(logged)).toEqual([
      expect.objectContaining({ step: "group_settings", code: "PGRST301", ids: { org: ORG } }),
    ]);
  });
});
