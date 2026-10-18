import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ensureGroupCalendar,
  getGroupCalendar,
  GROUP_DEFAULT_COLOR,
} from "@/lib/groups/calendar";

type Result = { data: unknown; error: unknown };

function makeClient(
  lookup: Result,
  insertResult: Result = { data: { id: "cal-new" }, error: null }
) {
  const eq: [string, unknown][] = [];
  const inserts: unknown[] = [];
  const builder = {
    select: () => builder,
    eq(col: string, val: unknown) {
      eq.push([col, val]);
      return builder;
    },
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => lookup,
    insert(payload: unknown) {
      inserts.push(payload);
      return { select: () => ({ single: async () => insertResult }) };
    },
  };
  const client = { from: () => builder } as unknown as SupabaseClient;
  return { client, eq, inserts };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getGroupCalendar", () => {
  it("scopes the read to the org and the group", async () => {
    const { client, eq } = makeClient({ data: null, error: null });

    await getGroupCalendar(client, "org-1", "grp-1");

    expect(eq).toEqual([
      ["org_id", "org-1"],
      ["group_id", "grp-1"],
    ]);
  });

  it("returns null when the group has no calendar", async () => {
    const { client } = makeClient({ data: null, error: null });

    expect(await getGroupCalendar(client, "org-1", "grp-1")).toBeNull();
  });

  it("throws when the read fails instead of reporting no calendar", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" } });

    await expect(getGroupCalendar(client, "org-1", "grp-1")).rejects.toThrow(
      /Failed to load the group calendar/
    );
    expect(console.error).toHaveBeenCalled();
  });
});

describe("ensureGroupCalendar", () => {
  it("returns the existing calendar without inserting", async () => {
    const { client, inserts } = makeClient({
      data: { id: "cal-1", name: "Group A", color: "#B85C38" },
      error: null,
    });

    expect(await ensureGroupCalendar(client, "org-1", "grp-1", "Group A")).toBe("cal-1");
    expect(inserts).toEqual([]);
  });

  it("creates the group's calendar only when the lookup confirmed there is none", async () => {
    const { client, inserts } = makeClient({ data: null, error: null });

    expect(await ensureGroupCalendar(client, "org-1", "grp-1", "Group A")).toBe("cal-new");
    expect(inserts).toEqual([
      { org_id: "org-1", group_id: "grp-1", name: "Group A", color: GROUP_DEFAULT_COLOR },
    ]);
  });

  it("returns null and never inserts when the lookup fails", async () => {
    const { client, inserts } = makeClient({ data: null, error: { message: "boom" } });

    expect(await ensureGroupCalendar(client, "org-1", "grp-1", "Group A")).toBeNull();
    expect(inserts).toEqual([]);
    expect(console.error).toHaveBeenCalled();
  });

  it("returns null when the insert fails", async () => {
    const { client } = makeClient(
      { data: null, error: null },
      { data: null, error: { message: "boom" } }
    );

    expect(await ensureGroupCalendar(client, "org-1", "grp-1", "Group A")).toBeNull();
  });
});
