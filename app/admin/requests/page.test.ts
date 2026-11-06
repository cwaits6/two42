import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Failure = { code: string } | null;
const ACCESS = [
  { id: "a1", status: "pending" },
  { id: "a2", status: "approved" },
];
const db = vi.hoisted(() => ({
  failing: null as string | null,
  rpcError: null as Failure,
  rpcGroups: [] as string[],
}));

// Rows carry a status and the mock applies the page's own filter, so a read
// that stops asking for pending rows shows up as a decided request listed.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      let rows: { id: string; status?: string }[] =
        table === "access_requests" ? ACCESS : table === "groups" ? [{ id: "grp1" }, { id: "grp2" }] : [];
      const chain = {
        select: () => chain,
        eq: (column: "status", value: string) => {
          rows = rows.filter((row) => row[column] === value);
          return chain;
        },
        order: () => chain,
        then: (resolve: (value: unknown) => void) =>
          resolve(table === db.failing ? { data: null, error: { code: "XX000" } } : { data: rows, error: null }),
      };
      return chain;
    },
    rpc: async (_name: string, { _group_id }: { _group_id: string }) => {
      db.rpcGroups.push(_group_id);
      return { data: [], error: db.rpcError };
    },
  }),
}));
vi.mock("@/lib/admin/requestCounts", () => ({ getWaitingRequestCount: async () => 1 }));
vi.mock("@/lib/time/orgZone", () => ({ getOrgTimeZone: async () => "America/Chicago" }));
vi.mock("./RequestsBoard", () => ({ RequestsBoard: () => null }));

const { default: RequestsPage } = await import("./page");

type Element = ReactElement<{ children?: Element | Element[]; fallback?: unknown }>;

/** The props the page hands the board: the async part sits inside the page's Suspense. */
async function boardProps() {
  const find = (node: Element): Element | undefined =>
    "fallback" in node.props
      ? (node.props.children as Element)
      : [node.props.children ?? []].flat().map(find).find(Boolean);
  const requests = find(RequestsPage() as Element)!;
  const board = await (requests.type as () => Promise<Element>)();
  return board.props as unknown as Record<"access" | "group" | "join", { id: string }[] | null> & {
    waiting: number | null;
  };
}

beforeEach(() => {
  db.failing = null;
  db.rpcError = null;
  db.rpcGroups = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("RequestsPage", () => {
  it("lists only what is still waiting, reads join requests for every group, and passes the count on", async () => {
    const props = await boardProps();

    expect(props.access).toEqual([{ id: "a1", status: "pending" }]);
    expect(props.group).toEqual([]);
    expect(props.join).toEqual([]);
    expect(db.rpcGroups).toEqual(["grp1", "grp2"]);
    expect(props.waiting).toBe(1);
  });

  it.each([
    ["the groups can't be read", () => (db.failing = "groups")],
    ["a group's join requests can't be read", () => (db.rpcError = { code: "XX000" })],
  ])("reports the join requests as unread, not empty, when %s, and still lists the rest", async (_case, fail) => {
    fail();
    const props = await boardProps();

    expect(props.join).toBeNull();
    expect(props.access).toHaveLength(1);
    expect(props.group).toEqual([]);
  });

  it.each([
    ["access", "access_requests"],
    ["group", "group_requests"],
  ] as const)("reports only the %s requests as unread when their read fails", async (kind, table) => {
    db.failing = table;
    const props = await boardProps();

    expect(props[kind]).toBeNull();
    expect(props.join).toEqual([]);
  });
});
