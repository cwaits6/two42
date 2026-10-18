import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  GROUP_SETTINGS_DEFAULTS,
  getGroupSettings,
  groupTextColor,
  validateGroupColor,
} from "@/lib/groups/settings";

describe("validateGroupColor", () => {
  it("accepts Clay, which carries white text", () => {
    expect(validateGroupColor("#B85C38")).toEqual({ ok: true, color: "#B85C38" });
  });

  it("accepts a light color that carries dark text", () => {
    expect(validateGroupColor("#FFFF00")).toEqual({ ok: true, color: "#FFFF00" });
  });

  it("rejects a mid-tone that carries neither white nor dark text", () => {
    const result = validateGroupColor("#7A7A7A");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/4\.5:1/);
  });

  it("rejects anything that is not six-digit hex", () => {
    for (const raw of ["red", "#B85", "#B85C38; color: red", 12, null]) {
      expect(validateGroupColor(raw).ok).toBe(false);
    }
  });
});

describe("groupTextColor", () => {
  it("lays white over a dark color and Espresso over a light one", () => {
    expect(groupTextColor("#B85C38")).toBe("#FFFFFF");
    expect(groupTextColor("#FFFF00")).toBe("#2A211A");
  });
});

function makeClient(result: { data: unknown; error: unknown }) {
  const eq: [string, unknown][] = [];
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq(col: string, val: unknown) {
          eq.push([col, val]);
          return this;
        },
        maybeSingle: async () => result,
        table,
      }),
    }),
  } as unknown as SupabaseClient;
  return { client, eq };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getGroupSettings", () => {
  it("scopes the read to the org and the group", async () => {
    const { client, eq } = makeClient({ data: null, error: null });

    await getGroupSettings(client, "org-1", "grp-1");

    expect(eq).toEqual([
      ["org_id", "org-1"],
      ["group_id", "grp-1"],
    ]);
  });

  it("returns the defaults when no row has been saved", async () => {
    const { client } = makeClient({ data: null, error: null });

    expect(await getGroupSettings(client, "org-1", "grp-1")).toEqual(GROUP_SETTINGS_DEFAULTS);
  });

  it("maps a saved row, normalizing the link mode", async () => {
    const { client } = makeClient({
      data: {
        weekly_zoom_url: "https://example.test/zoom",
        zoom_meeting_time: "Thursdays 7pm",
        weekly_prayer_call_url: null,
        weekly_prayer_call_time: null,
        serving_link_mode: "login",
      },
      error: null,
    });

    expect(await getGroupSettings(client, "org-1", "grp-1")).toEqual({
      weekly_zoom_url: "https://example.test/zoom",
      zoom_meeting_time: "Thursdays 7pm",
      weekly_prayer_call_url: null,
      weekly_prayer_call_time: null,
      serving_link_mode: "login",
    });
  });

  it("returns the defaults and logs when the read fails", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" } });

    expect(await getGroupSettings(client, "org-1", "grp-1")).toEqual(GROUP_SETTINGS_DEFAULTS);
    expect(console.error).toHaveBeenCalled();
  });
});
