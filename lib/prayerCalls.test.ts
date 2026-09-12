// Unit tests for the prayer-call session writer. savePrayerCallSessions takes
// its Supabase client as a parameter, so a recording fake is enough to
// assert the thing a reviewer cannot see by reading: that every read, update
// and delete filters on org_id and every insert stamps it. A passed-in
// client is untyped as to privilege, so a missing predicate here would be a
// silent cross-tenant write under a service-role caller.

import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { savePrayerCallSessions, type SessionDraft } from "@/lib/prayerCalls";
import type { PrayerCallSession } from "@/lib/types";

interface Call {
  table: string;
  op: "select" | "insert" | "update" | "delete";
  payload?: unknown;
  filters: [string, unknown][];
}

function fakeClient(
  options: {
    /** Scripted maybeSingle() rows keyed `${table}:${op}`; absent = null. */
    rows?: Record<string, { id: string } | null>;
    /** Tables whose awaited UPDATE should match zero rows. */
    matchesNothing?: string[];
    /** Tables whose awaited UPDATE should resolve with an error instead. */
    errors?: string[];
  } = {}
) {
  const calls: Call[] = [];
  const rows = options.rows ?? {};
  const matchesNothing = new Set(options.matchesNothing ?? []);
  const errors = new Set(options.errors ?? []);

  const builder = (table: string, op: Call["op"], payload?: unknown) => {
    const call: Call = { table, op, payload, filters: [] };
    calls.push(call);
    const key = `${table}:${op}`;
    const chain = {
      eq(column: string, value: unknown) {
        call.filters.push([column, value]);
        return chain;
      },
      select() {
        return chain;
      },
      single() {
        return Promise.resolve({ data: rows[key] ?? { id: `new-${table}` }, error: null });
      },
      maybeSingle() {
        return Promise.resolve({ data: rows[key] ?? null, error: null });
      },
      then(resolve: (value: { data: unknown[] | null; error: { message: string } | null }) => unknown) {
        if (errors.has(table)) {
          return Promise.resolve(resolve({ data: null, error: { message: "boom" } }));
        }
        const data = matchesNothing.has(table) ? [] : [{ id: "row-1" }];
        return Promise.resolve(resolve({ data, error: null }));
      },
    };
    return chain;
  };

  const client = {
    from(table: string) {
      return {
        select: () => builder(table, "select"),
        insert: (payload: unknown) => builder(table, "insert", payload),
        update: (payload: unknown) => builder(table, "update", payload),
        delete: () => builder(table, "delete"),
      };
    },
  } as unknown as SupabaseClient;

  return { client, calls };
}

const ORG = "org-1";
const CAL = "cal-1";

function draft(overrides: Partial<SessionDraft> = {}): SessionDraft {
  return {
    id: null,
    weekday: 2,
    start_time: "19:00",
    end_time: null,
    leader_id: null,
    dial_in: null,
    pin: null,
    join_url: null,
    event_id: null,
    display_order: 0,
    ...overrides,
  };
}

function session(overrides: Partial<PrayerCallSession> = {}): PrayerCallSession {
  return {
    id: "s-1",
    weekday: 2,
    start_time: "19:00",
    end_time: null,
    leader_id: null,
    dial_in: null,
    pin: null,
    join_url: null,
    event_id: "e-1",
    display_order: 0,
    ...overrides,
  } as PrayerCallSession;
}

const byTable = (calls: Call[], table: string, op: Call["op"]) =>
  calls.filter((c) => c.table === table && c.op === op);

describe("savePrayerCallSessions — calendar resolution", () => {
  it("reads the configured calendar filtered on its id AND the org", async () => {
    const { client, calls } = fakeClient({ rows: { "event_calendars:select": { id: CAL } } });
    await savePrayerCallSessions(client, ORG, [], [], CAL);
    const [read] = byTable(calls, "event_calendars", "select");
    expect(read.filters).toEqual([
      ["id", CAL],
      ["org_id", ORG],
    ]);
    expect(byTable(calls, "event_calendars", "insert")).toHaveLength(0);
  });

  it("re-creates the calendar with org_id stamped and repoints the setting within the org", async () => {
    // The scoped read matching nothing is what another tenant's calendar id
    // looks like — it must fall through to re-create, never be reused.
    const { client, calls } = fakeClient({ rows: { "event_calendars:insert": { id: "cal-new" } } });
    await savePrayerCallSessions(client, ORG, [], [], "someone-elses-calendar");
    const [insert] = byTable(calls, "event_calendars", "insert");
    expect(insert.payload).toMatchObject({ name: "Prayer", org_id: ORG });
    const [repoint] = byTable(calls, "site_settings", "update");
    expect(repoint.payload).toEqual({ value: "cal-new" });
    expect(repoint.filters).toEqual([
      ["key", "prayer_calendar_id"],
      ["org_id", ORG],
    ]);
  });

  it("logs but does not fail the save when the site_settings repoint errors", async () => {
    // The calendar itself was created successfully (created.id is used
    // directly below), so a repoint failure shouldn't fail the request — but
    // it should leave an operator-visible signal instead of vanishing.
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({
      rows: { "event_calendars:insert": { id: "cal-new" } },
      errors: ["site_settings"],
    });
    const result = await savePrayerCallSessions(client, ORG, [], [], "someone-elses-calendar");
    expect(result).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      "ensurePrayerCalendar: failed to repoint prayer_calendar_id for org %s:",
      ORG,
      { message: "boom" }
    );
    errorSpy.mockRestore();
  });
});

describe("savePrayerCallSessions — removed sessions", () => {
  it("deletes the synced event and then the session, each scoped on org_id", async () => {
    const { client, calls } = fakeClient({ rows: { "event_calendars:select": { id: CAL } } });
    await savePrayerCallSessions(client, ORG, [], [session({ id: "s-1", event_id: "e-1" })], CAL);
    const [eventDelete] = byTable(calls, "events", "delete");
    const [sessionDelete] = byTable(calls, "prayer_call_sessions", "delete");
    expect(eventDelete.filters).toEqual([
      ["id", "e-1"],
      ["org_id", ORG],
    ]);
    expect(sessionDelete.filters).toEqual([
      ["id", "s-1"],
      ["org_id", ORG],
    ]);
    expect(calls.indexOf(eventDelete)).toBeLessThan(calls.indexOf(sessionDelete));
  });
});

describe("savePrayerCallSessions — kept drafts", () => {
  it("updates an existing event and session, both scoped on org_id", async () => {
    const { client, calls } = fakeClient({ rows: { "event_calendars:select": { id: CAL } } });
    const d = draft({ id: "s-1", event_id: "e-1" });
    const result = await savePrayerCallSessions(client, ORG, [d], [], CAL);
    expect(result).toBeNull();
    const [eventUpdate] = byTable(calls, "events", "update");
    expect(eventUpdate.filters).toEqual([
      ["id", "e-1"],
      ["org_id", ORG],
    ]);
    const [sessionUpdate] = byTable(calls, "prayer_call_sessions", "update");
    expect(sessionUpdate.filters).toEqual([
      ["id", "s-1"],
      ["org_id", ORG],
    ]);
    expect(byTable(calls, "events", "insert")).toHaveLength(0);
  });

  it("stamps org_id on a new event and a new session", async () => {
    const { client, calls } = fakeClient({
      rows: {
        "event_calendars:select": { id: CAL },
        "events:insert": { id: "e-new" },
        "prayer_call_sessions:insert": { id: "s-new" },
      },
    });
    const d = draft();
    await savePrayerCallSessions(client, ORG, [d], [], CAL);
    const [eventInsert] = byTable(calls, "events", "insert");
    expect(eventInsert.payload).toMatchObject({ title: "Prayer call", calendar_id: CAL, org_id: ORG });
    const [sessionInsert] = byTable(calls, "prayer_call_sessions", "insert");
    expect(sessionInsert.payload).toMatchObject({ event_id: "e-new", org_id: ORG });
    expect(d).toMatchObject({ id: "s-new", event_id: "e-new" });
  });

  it("re-creates the event when the scoped update matches nothing", async () => {
    // An event id from another tenant now matches zero rows on the scoped
    // update — the existing "deleted out from under us" path handles it.
    const { client, calls } = fakeClient({
      rows: { "event_calendars:select": { id: CAL }, "events:insert": { id: "e-new" } },
      matchesNothing: ["events"],
    });
    const d = draft({ id: "s-1", event_id: "e-stale" });
    await savePrayerCallSessions(client, ORG, [d], [], CAL);
    expect(byTable(calls, "events", "update")).toHaveLength(1);
    const [eventInsert] = byTable(calls, "events", "insert");
    expect(eventInsert.payload).toMatchObject({ org_id: ORG });
    expect(d.event_id).toBe("e-new");
  });

  it("does not silently succeed when the scoped session update matches nothing", async () => {
    // A stale or cross-org draft.id now matches zero rows under the
    // newly-added org_id predicate — the update must not report success
    // without persisting anything, unlike the event update above it there is
    // no independent recreate path for a session.
    const { client, calls } = fakeClient({
      rows: { "event_calendars:select": { id: CAL } },
      matchesNothing: ["prayer_call_sessions"],
    });
    const d = draft({ id: "s-stale", event_id: "e-1" });
    const result = await savePrayerCallSessions(client, ORG, [d], [], CAL);
    expect(result).toBe("Couldn't save the call details. Please try again.");
    expect(byTable(calls, "prayer_call_sessions", "update")).toHaveLength(1);
    expect(byTable(calls, "prayer_call_sessions", "insert")).toHaveLength(0);
  });
});
