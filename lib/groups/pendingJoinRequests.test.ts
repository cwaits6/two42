// The reader fails closed: one failed per-group call makes the whole queue
// null, so the page says it could not load rather than showing a short list.

import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const { getPendingJoinRequests } = await import("@/lib/groups/pendingJoinRequests");

const GROUPS = [
  { id: "a", name: "Group A" },
  { id: "c", name: "Group C" },
];

function row(id: string) {
  return {
    id,
    created_at: "2026-10-20T10:00:00Z",
    first_name: "Isaac",
    last_name: "Seedly",
    preferred_name: null,
    email: null,
  };
}

function stubRpc(results: Record<string, { data?: unknown; error?: { code: string } }>) {
  const rpc = vi.fn(async (_fn: string, args: { _group_id: string }) => {
    const result = results[args._group_id];
    return { data: result.data ?? null, error: result.error ?? null };
  });
  createClient.mockResolvedValue({ rpc });
  return rpc;
}

beforeEach(() => {
  createClient.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getPendingJoinRequests", () => {
  it("reads every group once and tags each row with its group", async () => {
    const rpc = stubRpc({ a: { data: [row("r1")] }, c: { data: [row("r2"), row("r3")] } });
    const rows = await getPendingJoinRequests(GROUPS);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rows?.map((r) => [r.id, r.group.name])).toEqual([
      ["r1", "Group A"],
      ["r2", "Group C"],
      ["r3", "Group C"],
    ]);
  });

  it("is empty, not null, when no group has a request", async () => {
    stubRpc({ a: { data: [] }, c: { data: null } });
    expect(await getPendingJoinRequests(GROUPS)).toEqual([]);
  });

  it("is null when any one group's call fails", async () => {
    stubRpc({ a: { data: [row("r1")] }, c: { error: { code: "PGRST301" } } });
    expect(await getPendingJoinRequests(GROUPS)).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it("reads nothing when there are no groups", async () => {
    const rpc = stubRpc({});
    expect(await getPendingJoinRequests([])).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
  });
});
