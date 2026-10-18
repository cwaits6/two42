import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { ActiveGroup } from "@/lib/groups/active";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";
import { loadHomeCards } from "@/lib/groups/home";

const A: ActiveGroup = { id: "a", name: "Grace", color: GROUP_DEFAULT_COLOR, role: "leader" };
const B: ActiveGroup = { id: "b", name: "Hope", color: GROUP_DEFAULT_COLOR, role: "member" };

type Result = { data?: unknown[] | null; error: unknown };

function makeClient(results: Record<string, Result>) {
  const eqs: Record<string, [string, unknown][]> = {};
  const ins: Record<string, [string, unknown][]> = {};
  const client = {
    from(table: string) {
      eqs[table] = [];
      ins[table] = [];
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          eqs[table].push([col, val]);
          return chain;
        },
        in: (col: string, val: unknown) => {
          ins[table].push([col, val]);
          return chain;
        },
        or: () => chain,
        lte: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(results[table]).then(resolve, reject),
      };
      return chain;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, eqs, ins };
}

const NOW = new Date("2026-10-09T12:00:00Z");

async function loadOrFail(client: SupabaseClient<Database>, groups: ActiveGroup[]) {
  const result = await loadHomeCards(client, { orgId: "org-1", groups });
  if (!result) throw new Error("loadHomeCards reported a failed read");
  return result;
}

function event(id: string, start: string, groupId = "a") {
  return {
    id,
    group_id: groupId,
    title: `Event ${id}`,
    start_time: start,
    end_time: null,
    location: "Room 1",
    recurrence_frequency: null,
    recurrence_until: null,
    series_id: null,
  };
}

const groupRows = (...ids: string[]) => ids.map((group_id) => ({ group_id }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("loadHomeCards", () => {
  it("scopes every chain to the caller's org and the member's groups", async () => {
    const { client, eqs, ins } = makeClient({
      events: { data: [], error: null },
      announcements: { data: [], error: null },
      prayer_wall: { data: [], error: null },
    });

    await loadHomeCards(client, { orgId: "org-1", groups: [A, B] });

    for (const table of ["events", "announcements", "prayer_wall"]) {
      expect(eqs[table]).toContainEqual(["org_id", "org-1"]);
      expect(ins[table]).toEqual([["group_id", ["a", "b"]]]);
    }
  });

  it("returns one card per group with that group's next event and counts", async () => {
    const { client } = makeClient({
      events: {
        data: [
          event("e1", "2026-10-10T18:00:00Z", "a"),
          event("e2", "2026-10-11T18:00:00Z", "b"),
          event("e3", "2026-10-20T18:00:00Z", "a"),
        ],
        error: null,
      },
      announcements: { data: groupRows("a", "a", "b"), error: null },
      prayer_wall: { data: groupRows("b"), error: null },
    });

    const { cards } = await loadOrFail(client, [A, B]);

    expect(cards.map((c) => c.group)).toEqual([A, B]);
    expect(cards[0].nextEvent).toEqual({
      id: "e1",
      title: "Event e1",
      start_time: "2026-10-10T18:00:00Z",
      location: "Room 1",
    });
    expect(cards[0].announcementCount).toBe(2);
    expect(cards[0].prayerCount).toBe(0);
    expect(cards[1].nextEvent?.id).toBe("e2");
    expect(cards[1].announcementCount).toBe(1);
    expect(cards[1].prayerCount).toBe(1);
  });

  it("gives a group with nothing scheduled no next event and zero counts", async () => {
    const { client } = makeClient({
      events: { data: [event("e1", "2026-10-10T18:00:00Z", "a")], error: null },
      announcements: { data: groupRows("a"), error: null },
      prayer_wall: { data: [], error: null },
    });

    const { cards } = await loadOrFail(client, [A, B]);

    expect(cards[1]).toEqual({ group: B, nextEvent: null, announcementCount: 0, prayerCount: 0 });
  });

  it("lists the next seven days across groups, each row carrying its group", async () => {
    const { client } = makeClient({
      events: {
        data: [
          event("past", "2026-10-08T18:00:00Z", "a"),
          event("soon", "2026-10-12T18:00:00Z", "b"),
          event("later", "2026-10-20T18:00:00Z", "a"),
        ],
        error: null,
      },
      announcements: { data: null, error: null },
      prayer_wall: { data: null, error: null },
    });

    const { thisWeek, cards } = await loadOrFail(client, [A, B]);

    expect(thisWeek).toEqual([
      { event: { id: "soon", title: "Event soon", start_time: "2026-10-12T18:00:00Z", location: "Room 1" }, groupId: "b" },
    ]);
    expect(cards[0].announcementCount).toBe(0);
    expect(cards[0].prayerCount).toBe(0);
  });

  it("reports a failed read as null instead of an empty week and zero counts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = makeClient({
      events: { data: [event("soon", "2026-10-12T18:00:00Z")], error: null },
      announcements: { data: null, error: { message: "boom" } },
      prayer_wall: { data: [], error: null },
    });

    const result = await loadHomeCards(client, { orgId: "org-1", groups: [A] });

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith("Home %s read failed:", "announcements", { message: "boom" });
  });
});
