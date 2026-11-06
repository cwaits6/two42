import { afterEach, describe, expect, it, vi } from "vitest";
import { requestsWaiting, totalWaiting } from "./requestsWaiting";
import { loggedLines } from "@/lib/log/testing";

const reads = vi.hoisted(() => ({
  counts: {} as Record<string, number>,
  // What a failed HEAD count resolves to: with no body there is no code, and
  // a 404 has no error either.
  failing: null as { table: string; error: { message: string } | null; status: number } | null,
  filters: [] as [string, string, unknown][],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => ({
      // PostgREST returns a count only when the select asks for one.
      select: (_columns: string, options?: { count?: string }) => ({
        eq: async (column: string, value: unknown) => {
          reads.filters.push([table, column, value]);
          if (table === reads.failing?.table) {
            return { count: null, error: reads.failing.error, status: reads.failing.status };
          }
          return { count: options?.count === "exact" ? (reads.counts[table] ?? 0) : null, error: null, status: 200 };
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

  it.each([
    ["the API is down", { message: "" }, 503],
    ["the response carries no error and no count", null, 404],
  ])("gives no number, rather than a short one, when %s for one kind", async (_case, error, status) => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => {});
    reads.counts = { access_requests: 2, group_requests: 1 };
    reads.failing = { table: "group_join_requests", error, status };

    expect(await getWaitingRequestCount()).toBeNull();
    expect(loggedLines(logged)).toEqual([
      expect.objectContaining({ what: "Failed to count requests", step: "group_join_requests", ids: { status } }),
    ]);
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
