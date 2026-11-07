import { afterEach, describe, expect, it, vi } from "vitest";
import { loggedLines } from "@/lib/log/testing";

const reads = vi.hoisted(() => ({
  clients: 0,
  counts: {} as Record<string, number>,
  failing: null as string | null,
  queries: [] as { table: string; filters: [string, unknown][] }[],
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    reads.clients += 1;
    return {
      from: (table: string) => ({
        select: () => {
          const query = { table, filters: [] as [string, unknown][] };
          reads.queries.push(query);
          const chain = {
            eq: (column: string, value: unknown) => {
              query.filters.push([column, value]);
              return chain;
            },
            then: (resolve: (r: unknown) => void) => {
              const group = query.filters.find(([c]) => c === "group_id")?.[1] as string;
              resolve(
                group === reads.failing
                  ? { count: null, error: null, status: 404 }
                  : { count: reads.counts[group] ?? 0, error: null, status: 200 },
              );
            },
          };
          return chain;
        },
      }),
    };
  },
}));

const { getGroupWaitingRequestCounts } = await import("./joinRequestCounts");

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

afterEach(() => {
  reads.clients = 0;
  reads.counts = {};
  reads.failing = null;
  reads.queries = [];
  vi.restoreAllMocks();
});

describe("getGroupWaitingRequestCounts", () => {
  it("makes no read for no groups", async () => {
    expect(await getGroupWaitingRequestCounts([])).toEqual({});
    expect(reads.clients).toBe(0);
  });

  it("counts each group's pending requests by its own id", async () => {
    reads.counts = { [A]: 2, [B]: 0 };
    expect(await getGroupWaitingRequestCounts([A, B])).toEqual({ [A]: 2, [B]: 0 });
    expect(reads.queries).toEqual([
      { table: "group_join_requests", filters: [["group_id", A], ["status", "pending"]] },
      { table: "group_join_requests", filters: [["group_id", B], ["status", "pending"]] },
    ]);
  });

  it("leaves out a group whose count failed and keeps the others", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    reads.counts = { [A]: 3 };
    reads.failing = B;
    expect(await getGroupWaitingRequestCounts([A, B])).toEqual({ [A]: 3 });
    expect(loggedLines(log).map((line) => [line.what, line.ids?.group])).toEqual([["Failed to count a group's join requests", B]]);
  });
});
