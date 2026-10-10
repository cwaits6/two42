import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { GROUP_DEFAULT_COLOR, type ActiveGroup } from "@/lib/groups/active";
import { loadHomeCards } from "@/lib/groups/home";

const A: ActiveGroup = { id: "a", name: "Grace", color: GROUP_DEFAULT_COLOR, role: "leader" };
const B: ActiveGroup = { id: "b", name: "Hope", color: GROUP_DEFAULT_COLOR, role: "member" };

type Result = { data?: unknown[] | null; count?: number | null; error: unknown };

function makeClient(results: Record<string, Result>) {
  const eqs: Record<string, [string, unknown][]> = {};
  const client = {
    from(table: string) {
      eqs[table] = [];
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          eqs[table].push([col, val]);
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
  return { client, eqs };
}

const NOW = new Date("2026-10-09T12:00:00Z");

async function loadOrFail(client: SupabaseClient<Database>, groups: ActiveGroup[]) {
  const result = await loadHomeCards(client, { orgId: "org-1", groups });
  if (!result) throw new Error("loadHomeCards reported a failed read");
  return result;
}

function event(id: string, start: string) {
  return {
    id,
    title: `Event ${id}`,
    start_time: start,
    end_time: null,
    location: "Room 1",
    recurrence_frequency: null,
    recurrence_until: null,
    series_id: null,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("loadHomeCards", () => {
  it("scopes every chain to the caller's org", async () => {
    const { client, eqs } = makeClient({
      events: { data: [], error: null },
      announcements: { count: 0, error: null },
      prayer_wall: { count: 0, error: null },
    });

    await loadHomeCards(client, { orgId: "org-1", groups: [A] });

    for (const table of ["events", "announcements", "prayer_wall"]) {
      expect(eqs[table]).toContainEqual(["org_id", "org-1"]);
    }
  });

  it("returns one card per group carrying the same org-wide next event and counts", async () => {
    const { client } = makeClient({
      events: {
        data: [event("e1", "2026-10-10T18:00:00Z"), event("e2", "2026-10-20T18:00:00Z")],
        error: null,
      },
      announcements: { count: 4, error: null },
      prayer_wall: { count: 2, error: null },
    });

    const { cards } = await loadOrFail(client, [A, B]);

    expect(cards.map((c) => c.group)).toEqual([A, B]);
    for (const card of cards) {
      expect(card.nextEvent).toEqual({
        id: "e1",
        title: "Event e1",
        start_time: "2026-10-10T18:00:00Z",
        location: "Room 1",
      });
      expect(card.announcementCount).toBe(4);
      expect(card.prayerCount).toBe(2);
    }
  });

  it("lists the next seven days with no group on any row", async () => {
    const { client } = makeClient({
      events: {
        data: [
          event("past", "2026-10-08T18:00:00Z"),
          event("soon", "2026-10-12T18:00:00Z"),
          event("later", "2026-10-20T18:00:00Z"),
        ],
        error: null,
      },
      announcements: { count: null, error: null },
      prayer_wall: { count: null, error: null },
    });

    const { thisWeek, cards } = await loadOrFail(client, [A]);

    expect(thisWeek.map((r) => r.event.id)).toEqual(["soon"]);
    expect(thisWeek[0].groupId).toBeNull();
    expect(cards[0].announcementCount).toBe(0);
    expect(cards[0].prayerCount).toBe(0);
  });

  it("reports a failed read as null instead of an empty week and zero counts", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = makeClient({
      events: { data: [event("soon", "2026-10-12T18:00:00Z")], error: null },
      announcements: { count: null, error: { message: "boom" } },
      prayer_wall: { count: 3, error: null },
    });

    const result = await loadHomeCards(client, { orgId: "org-1", groups: [A] });

    expect(result).toBeNull();
    expect(console.error).toHaveBeenCalledWith("Home %s read failed:", "announcements", { message: "boom" });
  });
});
