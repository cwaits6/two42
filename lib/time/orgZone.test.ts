import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { siteConfig } from "@/lib/config";
import { getOrgTimeZone } from "@/lib/time/orgZone";

type Row = { data: { timezone: string } | null; error: { message: string } | null };

const maybeSingle = vi.fn<() => Promise<Row>>();

function mockOrganizationsRead(result: Row) {
  maybeSingle.mockResolvedValue(result);
  vi.mocked(createClient).mockResolvedValue({
    from: () => ({ select: () => ({ maybeSingle }) }),
  } as unknown as Awaited<ReturnType<typeof createClient>>);
}

beforeEach(() => {
  vi.mocked(createClient).mockReset();
  maybeSingle.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getOrgTimeZone", () => {
  it("returns the org's zone through the request-scoped client", async () => {
    mockOrganizationsRead({ data: { timezone: "America/Los_Angeles" }, error: null });
    expect(await getOrgTimeZone()).toBe("America/Los_Angeles");
    expect(createClient).toHaveBeenCalledWith();
  });

  it("falls back to the configured default and logs when the read errors", async () => {
    mockOrganizationsRead({ data: null, error: { message: "boom" } });
    expect(await getOrgTimeZone()).toBe(siteConfig.timeZone);
    expect(console.error).toHaveBeenCalled();
  });

  it("falls back and warns when no org row is visible", async () => {
    mockOrganizationsRead({ data: null, error: null });
    expect(await getOrgTimeZone()).toBe(siteConfig.timeZone);
    expect(console.warn).toHaveBeenCalled();
  });

  it("falls back when the stored zone is not one this runtime knows", async () => {
    mockOrganizationsRead({ data: { timezone: "Nowhere/Bogus" }, error: null });
    expect(await getOrgTimeZone()).toBe(siteConfig.timeZone);
    expect(console.error).toHaveBeenCalled();
  });

  it("falls back when the client itself throws", async () => {
    vi.mocked(createClient).mockRejectedValue(new Error("no cookies"));
    expect(await getOrgTimeZone()).toBe(siteConfig.timeZone);
  });
});
