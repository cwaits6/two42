import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultServingLinkMode, getServingLinkMode } from "./config";

function makeClient(result: { data: unknown; error: { message: string } | null }) {
  const maybeSingle = vi.fn().mockResolvedValue(result);
  const eq2 = vi.fn().mockReturnValue({ maybeSingle });
  const eq1 = vi.fn().mockReturnValue({ eq: eq2 });
  const select = vi.fn().mockReturnValue({ eq: eq1 });
  const from = vi.fn().mockReturnValue({ select });
  return { client: { from } as unknown as SupabaseClient, from, select, eq1, eq2 };
}

describe("getServingLinkMode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("scopes the read to the org and the group", async () => {
    const { client, from, select, eq1, eq2 } = makeClient({ data: null, error: null });
    await getServingLinkMode(client, "org-1", "grp-1");
    expect(from).toHaveBeenCalledWith("group_settings");
    expect(select).toHaveBeenCalledWith("serving_link_mode");
    expect(eq1).toHaveBeenCalledWith("org_id", "org-1");
    expect(eq2).toHaveBeenCalledWith("group_id", "grp-1");
  });

  it("uses the group's explicit choice over the environment", async () => {
    vi.stubEnv("SERVING_LINK_MODE", "login");
    const { client } = makeClient({ data: { serving_link_mode: "signed" }, error: null });
    expect(await getServingLinkMode(client, "org-1", "grp-1")).toBe("signed");
  });

  it("defers to SERVING_LINK_MODE when the row never chose a mode", async () => {
    vi.stubEnv("SERVING_LINK_MODE", "login");
    const { client } = makeClient({ data: { serving_link_mode: null }, error: null });
    expect(await getServingLinkMode(client, "org-1", "grp-1")).toBe("login");
  });

  it("defers to SERVING_LINK_MODE when no row exists", async () => {
    vi.stubEnv("SERVING_LINK_MODE", "login");
    const { client } = makeClient({ data: null, error: null });
    expect(await getServingLinkMode(client, "org-1", "grp-1")).toBe("login");
  });

  it("is signed when neither the row nor the environment chose", async () => {
    vi.stubEnv("SERVING_LINK_MODE", "");
    const { client } = makeClient({ data: null, error: null });
    expect(await getServingLinkMode(client, "org-1", "grp-1")).toBe("signed");
    expect(defaultServingLinkMode()).toBe("signed");
  });

  it("fails closed to login when the read errors", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = makeClient({ data: null, error: { message: "boom" } });
    expect(await getServingLinkMode(client, "org-1", "grp-1")).toBe("login");
  });
});
