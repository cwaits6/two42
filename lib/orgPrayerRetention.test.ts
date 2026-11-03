import { afterEach, describe, expect, it, vi } from "vitest";

const result = vi.hoisted(() => ({
  current: { data: null, error: null } as {
    data: { prayer_request_retention_months: number | null } | null;
    error: { message: string } | null;
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({ select: () => ({ maybeSingle: async () => result.current }) }),
  }),
}));

const { getPrayerRetention } = await import("./orgPrayerRetention");

afterEach(() => vi.restoreAllMocks());

describe("getPrayerRetention", () => {
  it("reads a null column as off", async () => {
    result.current = { data: { prayer_request_retention_months: null }, error: null };
    expect(await getPrayerRetention()).toBe("off");
  });

  it("returns an offered period", async () => {
    result.current = { data: { prayer_request_retention_months: 12 }, error: null };
    expect(await getPrayerRetention()).toBe(12);
  });

  it.each([
    ["a query error, such as the column not existing yet", { data: null, error: { message: "42703" } }],
    ["no visible row", { data: null, error: null }],
    ["a period that was never offered", { data: { prayer_request_retention_months: 7 }, error: null }],
  ])("is unknown, never off, on %s", async (_label, row) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    result.current = row;
    expect(await getPrayerRetention()).toBeNull();
  });
});
