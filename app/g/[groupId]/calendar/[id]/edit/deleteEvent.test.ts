import { describe, expect, it } from "vitest";
import type { createClient } from "@/lib/supabase/client";
import type { Event } from "@/lib/types";
import { cancelOccurrence, deleteEvent } from "./deleteEvent";

const NY_7PM = "2026-11-03T00:00:00.000Z";
const LEADER = "11111111-1111-4111-8111-111111111111";

const series = {
  id: "s",
  group_id: "g1",
  calendar_id: "c1",
  title: "Weekly",
  start_time: "2026-10-27T23:00:00.000Z",
  end_time: "2026-10-28T00:30:00.000Z",
  series_id: null,
  recurrence_frequency: "weekly",
  recurrence_interval: 1,
  recurrence_end_mode: "never",
  is_cancelled: false,
} as Event;

type Call = {
  table: string;
  op: "insert" | "delete";
  values?: Record<string, unknown>;
  filters: [string, unknown][];
  selected?: string;
};

type Response = { data: { id: string }[] | null; error: { message: string } | null };

// Records every write the helpers issue; `select` ends the chain and answers
// with the given response, the way the real client resolves a query.
function stubClient(
  respond: (call: Call) => Response,
  getUser: () => Promise<unknown> = async () => ({ data: { user: { id: LEADER } }, error: null })
) {
  const calls: Call[] = [];
  const chain = (call: Call) => {
    const self = {
      eq(column: string, value: unknown) {
        call.filters.push([column, value]);
        return self;
      },
      select(columns: string) {
        call.selected = columns;
        return Promise.resolve(respond(call));
      },
    };
    return self;
  };
  const client = {
    auth: { getUser },
    from(table: string) {
      return {
        insert(values: Record<string, unknown>) {
          const call: Call = { table, op: "insert", values, filters: [] };
          calls.push(call);
          return chain(call);
        },
        delete() {
          const call: Call = { table, op: "delete", filters: [] };
          calls.push(call);
          return chain(call);
        },
      };
    },
  };
  return { client: client as unknown as ReturnType<typeof createClient>, calls };
}

const oneRow: Response = { data: [{ id: "new" }], error: null };

describe("cancelOccurrence", () => {
  it("records the date as a cancelled exception of the series and deletes nothing", async () => {
    const { client, calls } = stubClient(() => oneRow);

    expect(await cancelOccurrence(client, series, NY_7PM)).toBe(true);

    expect(calls.filter((c) => c.op === "delete")).toEqual([]);
    expect(calls).toHaveLength(1);
    const [write] = calls;
    expect(write.table).toBe("events");
    expect(write.selected).toBe("id");
    expect(write.values).toMatchObject({
      series_id: "s",
      series_occurrence_date: NY_7PM,
      is_cancelled: true,
      start_time: NY_7PM,
      end_time: "2026-11-03T01:30:00.000Z",
      group_id: "g1",
      calendar_id: "c1",
      title: "Weekly",
      created_by: LEADER,
    });
  });

  it("normalises the chosen date to an ISO instant", async () => {
    const { client, calls } = stubClient(() => oneRow);
    await cancelOccurrence(client, series, "2026-11-02T19:00:00-05:00");
    expect(calls[0].values).toMatchObject({
      start_time: NY_7PM,
      series_occurrence_date: NY_7PM,
    });
  });

  it("reports failure on a write error or when no row comes back", async () => {
    const errored = stubClient(() => ({ data: null, error: { message: "denied" } }));
    expect(await cancelOccurrence(errored.client, series, NY_7PM)).toBe(false);

    const empty = stubClient(() => ({ data: [], error: null }));
    expect(await cancelOccurrence(empty.client, series, NY_7PM)).toBe(false);
  });

  it("writes nothing when the signed-in user cannot be resolved", async () => {
    const signedOut = stubClient(
      () => oneRow,
      async () => ({ data: { user: null }, error: { message: "session expired" } })
    );
    expect(await cancelOccurrence(signedOut.client, series, NY_7PM)).toBe(false);
    expect(signedOut.calls).toEqual([]);
  });
});

describe("deleteEvent", () => {
  it("deletes a one-off event, or a whole series, by id within its group", async () => {
    const { client, calls } = stubClient(() => oneRow);

    expect(await deleteEvent(client, "s", "g1")).toBe(true);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      table: "events",
      op: "delete",
      selected: "id",
      filters: [
        ["id", "s"],
        ["group_id", "g1"],
      ],
    });
  });

  it("treats a delete that matches no row as a failure", async () => {
    const empty = stubClient(() => ({ data: [], error: null }));
    expect(await deleteEvent(empty.client, "s", "g1")).toBe(false);

    const errored = stubClient(() => ({ data: null, error: { message: "denied" } }));
    expect(await deleteEvent(errored.client, "s", "g1")).toBe(false);
  });
});
