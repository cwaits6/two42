// The download runs on the service client, which bypasses RLS, so the
// route's own `.eq()` predicates are the only thing keeping a cancelled date
// (and another org's or group's row) out of the file. The stub applies them
// to the rows it holds, the way the database would, so a dropped predicate
// hands the row back and the assertion sees a VEVENT.

import { beforeEach, describe, expect, it, vi } from "vitest";

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
}));

const { GET } = await import("@/app/api/events/[id]/ics/route");

const ORG = "org-1";
const OWNER = "user-1";
const GROUP = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TOKEN = "11111111-1111-4111-8111-111111111111";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown };

// A read resolves to the held rows after the recorded `.eq()` predicates are
// applied; `.single()` answers the way PostgREST does when none match.
function filteredChain(rows: Row[], record: (filter: [string, unknown]) => void) {
  const filters: Array<(row: Row) => boolean> = [];
  const matches = () => rows.filter((row) => filters.every((f) => f(row)));
  const obj = {
    select: () => obj,
    eq(col: string, val: unknown) {
      record([col, val]);
      filters.push((row) => row[col] === val);
      return obj;
    },
    in(col: string, vals: unknown[]) {
      record([col, vals]);
      filters.push((row) => vals.includes(row[col]));
      return obj;
    },
    single: async (): Promise<Result> => {
      const [row] = matches();
      return row ? { data: row, error: null } : { data: null, error: { code: "PGRST116" } };
    },
    maybeSingle: async (): Promise<Result> => ({ data: matches()[0] ?? null, error: null }),
    then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: matches(), error: null }).then(resolve, reject),
  };
  return obj;
}

function tokenChain(terminal: Result) {
  const obj = {
    select: () => obj,
    update: () => obj,
    eq: () => obj,
    single: async () => terminal,
    maybeSingle: async () => terminal,
    then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve, reject),
  };
  return obj;
}

function event(id: string, title: string, isCancelled: boolean): Row {
  return {
    id,
    org_id: ORG,
    group_id: GROUP,
    title,
    description: null,
    location: null,
    start_time: "2030-01-05T15:00:00.000Z",
    end_time: null,
    is_cancelled: isCancelled,
  };
}

// The first Thursday noon UTC after a week from now: a date of the series below.
function nextThursdayNoon(): string {
  const d = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + ((4 - d.getUTCDay() + 7) % 7));
  return d.toISOString();
}

function makeServiceClient() {
  const predicates: Array<[string, unknown]> = [];
  const events = [
    event("event-live", "Weekly event", false),
    event("event-gone", "Cancelled date", true),
    { ...event("anchor", "Weekly study", false), meeting_id: "123 456 7890", meeting_passcode: "faith" },
    { ...event("moved-date", "Weekly study", false), series_id: "anchor" },
    {
      ...event("series", "Thursday study", false),
      start_time: "2025-01-02T12:00:00.000Z",
      recurrence_frequency: "weekly",
      recurrence_interval: 1,
      recurrence_end_mode: "never",
      series_id: null,
    },
    {
      ...event("series-deleted", "Thursday study", true),
      series_id: "series",
      series_occurrence_date: nextThursdayNoon(),
      start_time: nextThursdayNoon(),
    },
  ];
  const client = {
    from(table: string) {
      switch (table) {
        case "calendar_subscription_tokens":
          return tokenChain({
            data: { id: "sub-1", user_id: OWNER, org_id: ORG, expires_at: "2030-01-01T00:00:00.000Z" },
            error: null,
          });
        case "profiles":
          return tokenChain({ data: { role: "member" }, error: null });
        case "group_settings":
          return filteredChain([], () => {});
        case "organizations":
          return tokenChain({ data: { timezone: "UTC" }, error: null });
        case "group_members":
          return filteredChain([{ org_id: ORG, profile_id: OWNER, group_id: GROUP }], () => {});
        case "events":
          return filteredChain(events, (filter) => predicates.push(filter));
        default:
          throw new Error(`unexpected table ${table}`);
      }
    },
  };
  return { client, predicates };
}

function icsRequest(id: string) {
  return GET(new Request(`http://localhost/api/events/${id}/ics?token=${TOKEN}`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  createServiceClient.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/events/[id]/ics", () => {
  it("serves a live event as a calendar file", async () => {
    const { client } = makeServiceClient();
    createServiceClient.mockResolvedValue(client);

    const res = await icsRequest("event-live");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("BEGIN:VEVENT");
    expect(body).toContain("SUMMARY:Weekly event");
  });

  it("does not find a cancelled date, so nothing goes on a calendar", async () => {
    const { client, predicates } = makeServiceClient();
    createServiceClient.mockResolvedValue(client);

    const res = await icsRequest("event-gone");
    const body = await res.text();

    expect(res.status).toBe(404);
    expect(body).not.toContain("BEGIN:VEVENT");
    expect(body).not.toContain("Cancelled date");
    expect(predicates).toEqual(
      expect.arrayContaining([
        ["org_id", ORG],
        ["is_cancelled", false],
      ])
    );
  });

  it("gives a moved date its series' meeting", async () => {
    const { client, predicates } = makeServiceClient();
    createServiceClient.mockResolvedValue(client);

    const res = await icsRequest("moved-date");
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("Meeting ID: 123 456 7890");
    expect(body).toContain("Passcode: faith");
    expect(predicates).toEqual(expect.arrayContaining([["id", "anchor"], ["group_id", GROUP]]));
  });

  it("lists a subscribed series' dates, without the deleted one", async () => {
    const { client, predicates } = makeServiceClient();
    createServiceClient.mockResolvedValue(client);

    const body = await (await icsRequest("series")).text();
    const uids = body.match(/UID:series-\d{4}-\d{2}-\d{2}/g) ?? [];

    expect(uids.length).toBeGreaterThanOrEqual(55);
    expect(body).not.toContain(`UID:series-${nextThursdayNoon().slice(0, 10)}`);
    expect(predicates).toEqual(expect.arrayContaining([["series_id", "series"], ["group_id", GROUP]]));
  });
});
