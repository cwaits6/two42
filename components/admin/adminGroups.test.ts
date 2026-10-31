import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { listAdminGroups } from "./adminGroups";

function stubClient(result: { data: unknown[] | null; error: { message: string } | null }) {
  const calls: { method: string; args: unknown[] }[] = [];
  const chain = {
    select: (...args: unknown[]) => (calls.push({ method: "select", args }), chain),
    eq: (...args: unknown[]) => (calls.push({ method: "eq", args }), chain),
    order: async (...args: unknown[]) => (calls.push({ method: "order", args }), result),
  };
  const client = { from: () => chain } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

const name = (first: string, last: string) => ({ first_name: first, last_name: last, preferred_name: null });

describe("listAdminGroups", () => {
  it("narrows only the leaders embed to leaders, so every group still comes back", async () => {
    const { client, calls } = stubClient({ data: [], error: null });
    await listAdminGroups(client);
    const select = String(calls.find((c) => c.method === "select")?.args[0]);
    expect(select).toContain("members:group_members(count)");
    expect(select).toContain("leaders:group_members(");
    expect(calls.filter((c) => c.method === "eq").map((c) => c.args)).toEqual([["leaders.role", "leader"]]);
  });

  it("maps each group to its member count and sorted leader names, empty when it has none", async () => {
    const { client } = stubClient({
      data: [
        {
          id: "g1",
          name: "Tuesday Group",
          description: null,
          members: [{ count: 5 }],
          leaders: [{ profiles: name("Cy", "Park") }, { profiles: name("Ada", "Lovelace") }],
        },
        { id: "g2", name: "Wednesday Group", description: "Midweek", members: [{ count: 2 }], leaders: [] },
      ],
      error: null,
    });
    expect(await listAdminGroups(client)).toEqual([
      { id: "g1", name: "Tuesday Group", description: null, memberCount: 5, leaderNames: ["Ada Lovelace", "Cy Park"] },
      { id: "g2", name: "Wednesday Group", description: "Midweek", memberCount: 2, leaderNames: [] },
    ]);
  });

  it("resolves null when the read fails, not an empty list", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = stubClient({ data: null, error: { message: "boom" } });
    expect(await listAdminGroups(client)).toBeNull();
    vi.restoreAllMocks();
  });
});
