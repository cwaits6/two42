import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";
import { loadGroupMemberships } from "@/lib/groups/memberships";

type Result = { data: unknown[] | null; error: unknown };

type Calls = { select: string; eq: [string, unknown][]; in: [string, unknown][]; order: string[] };

function makeClient(results: Record<string, Result>) {
  const calls: Record<string, Calls> = {};
  const client = {
    from(table: string) {
      const record: Calls = { select: "", eq: [], in: [], order: [] };
      calls[table] = record;
      const chain = {
        select(cols: string) {
          record.select = cols;
          return chain;
        },
        eq(col: string, val: unknown) {
          record.eq.push([col, val]);
          return chain;
        },
        in(col: string, val: unknown) {
          record.in.push([col, val]);
          return chain;
        },
        order(col: string) {
          record.order.push(col);
          return chain;
        },
        then(resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) {
          return Promise.resolve(results[table] ?? { data: [], error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

const rows = [
  { group_id: "g1", role: "leader", joined_at: "2026-01-01", groups: { name: "Grace" } },
  { group_id: "g2", role: "member", joined_at: "2026-02-01", groups: [{ name: "Hope" }] },
];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadGroupMemberships", () => {
  it("scopes the membership chain to the profile and the caller's org, ordered by joined_at", async () => {
    const { client, calls } = makeClient({ group_members: { data: [], error: null } });

    await loadGroupMemberships(client, { profileId: "p1", orgId: "org-1" });

    expect(calls.group_members.eq).toEqual([
      ["profile_id", "p1"],
      ["org_id", "org-1"],
    ]);
    expect(calls.group_members.order).toEqual(["joined_at", "group_id"]);
    expect(calls.event_calendars).toBeUndefined();
  });

  it("reads each group's calendar color scoped to the org and the member's groups", async () => {
    const { client, calls } = makeClient({
      group_members: { data: rows, error: null },
      event_calendars: {
        data: [
          { group_id: "g1", color: "#2E6F5E", created_at: "2026-01-01", id: "c1" },
          { group_id: "g1", color: "#111111", created_at: "2026-01-02", id: "c2" },
        ],
        error: null,
      },
    });

    const result = await loadGroupMemberships(client, { profileId: "p1", orgId: "org-1" });

    expect(calls.event_calendars.eq).toEqual([["org_id", "org-1"]]);
    expect(calls.event_calendars.in).toEqual([["group_id", ["g1", "g2"]]]);
    expect(calls.event_calendars.order).toEqual(["created_at", "id"]);
    expect(result).toEqual([
      { id: "g1", name: "Grace", color: "#2E6F5E", role: "leader" },
      { id: "g2", name: "Hope", color: GROUP_DEFAULT_COLOR, role: "member" },
    ]);
  });

  it("falls back to Clay for a calendar color that is not six-digit hex", async () => {
    const { client } = makeClient({
      group_members: { data: [rows[0]], error: null },
      event_calendars: {
        data: [{ group_id: "g1", color: "red", created_at: "2026-01-01", id: "c1" }],
        error: null,
      },
    });

    const [group] = await loadGroupMemberships(client, { profileId: "p1", orgId: "org-1" });

    expect(group.color).toBe(GROUP_DEFAULT_COLOR);
  });

  it("maps an unexpected role to member", async () => {
    const { client } = makeClient({
      group_members: {
        data: [{ group_id: "g1", role: "owner", joined_at: "2026-01-01", groups: { name: "Grace" } }],
        error: null,
      },
    });

    const [row] = await loadGroupMemberships(client, { profileId: "p1", orgId: "org-1" });

    expect(row.role).toBe("member");
  });

  it("throws on a membership query error so a failed read never reads as no memberships", async () => {
    const { client } = makeClient({ group_members: { data: null, error: { message: "boom" } } });

    await expect(
      loadGroupMemberships(client, { profileId: "p1", orgId: "org-1" })
    ).rejects.toThrow("boom");
    expect(console.error).toHaveBeenCalled();
  });

  it("throws on a calendar query error rather than painting every group Clay", async () => {
    const { client } = makeClient({
      group_members: { data: rows, error: null },
      event_calendars: { data: null, error: { message: "cal boom" } },
    });

    await expect(
      loadGroupMemberships(client, { profileId: "p1", orgId: "org-1" })
    ).rejects.toThrow("cal boom");
  });
});
