import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/active";
import { loadGroupMemberships } from "@/lib/groups/memberships";

type Result = { data: unknown[] | null; error: unknown };

function makeClient(result: Result) {
  const calls = { table: "", select: "", eq: [] as [string, unknown][], order: [] as string[] };
  const chain = {
    select(cols: string) {
      calls.select = cols;
      return chain;
    },
    eq(col: string, val: unknown) {
      calls.eq.push([col, val]);
      return chain;
    },
    order(col: string) {
      calls.order.push(col);
      return chain;
    },
    then(resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  const client = {
    from(table: string) {
      calls.table = table;
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadGroupMemberships", () => {
  it("scopes the chain to the profile and the caller's org, ordered by joined_at", async () => {
    const { client, calls } = makeClient({ data: [], error: null });

    await loadGroupMemberships(client, { profileId: "p1", orgId: "org-1" });

    expect(calls.table).toBe("group_members");
    expect(calls.eq).toEqual([
      ["profile_id", "p1"],
      ["org_id", "org-1"],
    ]);
    expect(calls.order).toEqual(["joined_at", "group_id"]);
  });

  it("maps rows to the active-group shape with the default color", async () => {
    const { client } = makeClient({
      data: [
        { group_id: "g1", role: "leader", groups: { name: "Grace" } },
        { group_id: "g2", role: "member", groups: [{ name: "Hope" }] },
      ],
      error: null,
    });

    const result = await loadGroupMemberships(client, { profileId: "p1", orgId: "org-1" });

    expect(result).toEqual([
      { id: "g1", name: "Grace", color: GROUP_DEFAULT_COLOR, role: "leader" },
      { id: "g2", name: "Hope", color: GROUP_DEFAULT_COLOR, role: "member" },
    ]);
  });

  it("maps an unexpected role to member", async () => {
    const { client } = makeClient({
      data: [{ group_id: "g1", role: "owner", groups: { name: "Grace" } }],
      error: null,
    });

    const [row] = await loadGroupMemberships(client, { profileId: "p1", orgId: "org-1" });

    expect(row.role).toBe("member");
  });

  it("throws on a query error so a failed read never reads as no memberships", async () => {
    const { client } = makeClient({ data: null, error: { message: "boom" } });

    await expect(
      loadGroupMemberships(client, { profileId: "p1", orgId: "org-1" })
    ).rejects.toThrow("boom");
    expect(console.error).toHaveBeenCalled();
  });
});
