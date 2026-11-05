import { afterEach, describe, expect, it, vi } from "vitest";
import { requestsWaiting, totalWaiting } from "./requestsWaiting";

const reads = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  failing: null as string | null,
  filters: [] as [string, string, unknown][],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => ({
      select: () => ({
        eq: async (column: string, value: unknown) => {
          reads.filters.push([table, column, value]);
          return table === reads.failing
            ? { count: null, error: { code: "XX000", message: "row content" } }
            : { count: reads.counts[table] ?? 0, error: null };
        },
      }),
    }),
  }),
}));

const { getWaitingRequestCount } = await import("./requestCounts");

afterEach(() => {
  reads.counts = {};
  reads.failing = null;
  reads.filters = [];
  vi.restoreAllMocks();
});

describe("getWaitingRequestCount", () => {
  it("adds the three kinds, counting only what is still pending", async () => {
    reads.counts = { access_requests: 2, group_requests: 1, group_join_requests: 4 };

    expect(await getWaitingRequestCount()).toBe(7);
    expect(reads.filters).toEqual([
      ["access_requests", "status", "pending"],
      ["group_requests", "status", "pending"],
      ["group_join_requests", "status", "pending"],
    ]);
  });

  it("is zero when nothing is waiting", async () => {
    expect(await getWaitingRequestCount()).toBe(0);
  });

  it("gives no number, rather than a short one, when a kind can't be counted", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    reads.counts = { access_requests: 2, group_requests: 1 };
    reads.failing = "group_join_requests";

    expect(await getWaitingRequestCount()).toBeNull();
    expect(logged).toHaveBeenCalledWith("Failed to count %s requests: code=%s", "join", "XX000");
  });
});

describe("totalWaiting", () => {
  it("is unknown when any kind is unknown", () => {
    expect(totalWaiting({ access: 1, group: 2, join: 3 })).toBe(6);
    expect(totalWaiting({ access: 1, group: null, join: 3 })).toBeNull();
  });
});

describe("requestsWaiting", () => {
  it("says how many, and says so once when there are none", () => {
    expect(requestsWaiting(0)).toBe("No requests waiting.");
    expect(requestsWaiting(1)).toBe("1 request waiting.");
    expect(requestsWaiting(3)).toBe("3 requests waiting.");
  });
});
