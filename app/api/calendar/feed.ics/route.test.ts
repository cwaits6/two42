// The feed runs on the service client, which bypasses RLS, so the owner's
// group_members rows and the `.in("group_id", …)` predicates are the only
// group boundary on this surface — pgTAP cannot see it. The stub below
// applies the route's own `.eq()` / `.in()` filters to the rows it holds,
// so a dropped predicate would leak the other group's rows into the body.

import { beforeEach, describe, expect, it, vi } from "vitest";

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => createServiceClient(),
}));

// A fixed clock: how many weekly dates fall in the feed's window depends on
// the day, so a count asserted against the real clock would drift.
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-11-04T00:00:00.000Z"));

const { GET } = await import("@/app/api/calendar/feed.ics/route");

const ORG = "org-1";
const OWNER = "user-1";
const GROUP_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GROUP_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TOKEN = "11111111-1111-4111-8111-111111111111";

type Row = Record<string, unknown>;
type Result = { data: unknown; error: unknown };

// The values at a dotted embed path; an embedded array (an inner join with
// several rows) contributes every element, so a predicate on it matches any.
function valuesAt(row: Row, path: string): unknown[] {
  return path.split(".").reduce<unknown[]>(
    (acc, key) =>
      acc.flatMap((node) => {
        if (Array.isArray(node)) return node.map((item) => (item as Row)[key]);
        if (node && typeof node === "object") return [(node as Row)[key]];
        return [];
      }),
    [row]
  );
}

// A list read resolves to the held rows after the recorded `.eq()` / `.in()`
// predicates are applied, the way the database would.
function listChain(rows: Row[], record: (filter: [string, unknown]) => void) {
  const filters: Array<(row: Row) => boolean> = [];
  let slice: [number, number?] = [0];
  const obj = {
    select: () => obj,
    eq(col: string, val: unknown) {
      record(["eq", { [col]: val }]);
      filters.push((row) => valuesAt(row, col).includes(val));
      return obj;
    },
    in(col: string, vals: unknown[]) {
      record(["in", { [col]: vals }]);
      filters.push((row) => valuesAt(row, col).some((v) => vals.includes(v)));
      return obj;
    },
    gte(col: string, val: string) {
      filters.push((row) => String(row[col]) >= val);
      return obj;
    },
    lte(col: string, val: string) {
      filters.push((row) => String(row[col]) <= val);
      return obj;
    },
    // The route's one `.or()`: comma-separated arms, each a bare condition or
    // an and(...) of them, with gte / lte / is.null / not.is.null operators.
    or(expr: string) {
      const split = (text: string) => {
        const parts: string[] = [];
        let depth = 0;
        let start = 0;
        for (let i = 0; i < text.length; i++) {
          if (text[i] === "(") depth++;
          else if (text[i] === ")") depth--;
          else if (text[i] === "," && depth === 0) {
            parts.push(text.slice(start, i));
            start = i + 1;
          }
        }
        return [...parts, text.slice(start)];
      };
      const condition = (arm: string): ((row: Row) => boolean) => {
        if (arm.startsWith("and(")) {
          const all = split(arm.slice(4, -1)).map(condition);
          return (row) => all.every((c) => c(row));
        }
        const [col, ...rest] = arm.split(".");
        const op = rest.join(".");
        if (op === "not.is.null") return (row) => row[col] != null;
        if (op === "is.null") return (row) => row[col] == null;
        if (op.startsWith("gte.")) return (row) => row[col] != null && String(row[col]) >= op.slice(4);
        if (op.startsWith("lte.")) return (row) => row[col] != null && String(row[col]) <= op.slice(4);
        throw new Error(`unsupported or arm ${arm}`);
      };
      const arms = split(expr).map(condition);
      filters.push((row) => arms.some((arm) => arm(row)));
      return obj;
    },
    order: () => obj,
    limit(n: number) {
      slice = [0, n];
      return obj;
    },
    range(from: number, to: number) {
      slice = [from, to + 1];
      return obj;
    },
    then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({
        data: rows.filter((row) => filters.every((f) => f(row))).slice(...slice),
        error: null,
      }).then(resolve, reject),
  };
  return obj;
}

function singleChain(terminal: Result) {
  const obj = {
    select: () => obj,
    update: () => obj,
    eq: () => obj,
    single: async () => terminal,
    maybeSingle: async () => terminal,
    then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(terminal).then(resolve, reject),
  };
  return obj;
}

function errorChain(message: string) {
  const terminal: Result = { data: null, error: { message } };
  const obj = {
    select: () => obj,
    eq: () => obj,
    in: () => obj,
    then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(terminal).then(resolve, reject),
  };
  return obj;
}

const DAY = 24 * 60 * 60 * 1000;
// Inside the feed's window, which runs from a month back to a year ahead.
const SOON = new Date(Date.now() + 7 * DAY).toISOString();
// A weekly series that began long before the window, at noon UTC so its
// dates fall on the same calendar day in the test zone.
const SERIES_START = "2025-01-05T12:00:00.000Z";

function event(id: string, groupId: string, title: string): Row {
  return {
    id,
    org_id: ORG,
    group_id: groupId,
    title,
    description: null,
    location: null,
    start_time: SOON,
    end_time: null,
    is_cancelled: false,
    series_id: null,
    recurrence_frequency: null,
    recurrence_interval: 1,
    recurrence_end_mode: null,
  };
}

function weekly(id: string, groupId: string, title: string, extra: Row = {}): Row {
  return {
    ...event(id, groupId, title),
    start_time: SERIES_START,
    recurrence_frequency: "weekly",
    recurrence_end_mode: "never",
    ...extra,
  };
}

// The series date nearest to `SOON`, at the series' time of day.
function seriesDateNear(iso: string): string {
  const start = Date.parse(SERIES_START);
  const weeks = Math.round((Date.parse(iso) - start) / (7 * DAY));
  return new Date(start + weeks * 7 * DAY).toISOString();
}

function signup(id: string, groupId: string, teamName: string): Row {
  return {
    id,
    org_id: ORG,
    service_date: "2030-01-05",
    teams: { name: teamName, group_id: groupId },
    serving_signup_attendees: [{ profile_id: OWNER }],
  };
}

function makeServiceClient(opts: { memberships: Row[] | "error"; extraEvents?: Row[] }) {
  const predicates: Record<string, Array<[string, unknown]>> = {};
  const record = (table: string) => (filter: [string, unknown]) => {
    (predicates[table] ??= []).push(filter);
  };
  const events = [
    event("event-a", GROUP_A, "A event"),
    event("event-b", GROUP_B, "B event"),
    { ...event("event-x", GROUP_A, "Cancelled date"), is_cancelled: true },
    weekly("study-a", GROUP_A, "Study", { meeting_id: "111 222 3333" }),
    // One date deleted, the next one moved a day later.
    {
      ...event("deleted-a", GROUP_A, "Study"),
      series_id: "study-a",
      series_occurrence_date: seriesDateNear(SOON),
      start_time: seriesDateNear(SOON),
      is_cancelled: true,
    },
    {
      ...event("moved-a", GROUP_A, "Moved study"),
      series_id: "study-a",
      series_occurrence_date: seriesDateNear(new Date(Date.parse(SOON) + 7 * DAY).toISOString()),
      start_time: new Date(Date.parse(seriesDateNear(SOON)) + 8 * DAY).toISOString(),
    },
    // A date moved two years out, past the window's end.
    {
      ...event("moved-far", GROUP_A, "Far study"),
      series_id: "study-a",
      series_occurrence_date: seriesDateNear(new Date(Date.parse(SOON) + 21 * DAY).toISOString()),
      start_time: new Date(Date.parse(SOON) + 730 * DAY).toISOString(),
    },
    weekly("study-b", GROUP_B, "Other study", { meeting_id: "999 888 7777" }),
    ...(opts.extraEvents ?? []),
  ];
  const signups = [
    signup("signup-a", GROUP_A, "Greeters A"),
    signup("signup-b", GROUP_B, "Greeters B"),
  ];
  const client = {
    from(table: string) {
      switch (table) {
        case "calendar_subscription_tokens":
          return singleChain({
            data: {
              id: "sub-1",
              user_id: OWNER,
              org_id: ORG,
              expires_at: "2030-01-01T00:00:00.000Z",
            },
            error: null,
          });
        case "profiles":
          return singleChain({ data: { role: "member" }, error: null });
        case "organizations":
          return singleChain({ data: { timezone: "UTC" }, error: null });
        case "group_members":
          return opts.memberships === "error"
            ? errorChain("boom")
            : listChain(opts.memberships, record(table));
        case "events":
          return listChain(events, record(table));
        case "serving_signups":
          return listChain(signups, record(table));
        default:
          throw new Error(`unexpected table ${table}`);
      }
    },
  };
  return { client, predicates };
}

const memberOfAOnly = [{ org_id: ORG, profile_id: OWNER, group_id: GROUP_A, groups: { name: "Group A" } }];

function feedRequest(query = "") {
  return new Request(`http://localhost/api/calendar/feed.ics?token=${TOKEN}${query}`);
}

beforeEach(() => {
  createServiceClient.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/calendar/feed.ics — group boundary", () => {
  it("merges only the owner's groups, each entry prefixed with its group name", async () => {
    const { client, predicates } = makeServiceClient({ memberships: memberOfAOnly });
    createServiceClient.mockResolvedValue(client);

    const res = await GET(feedRequest());
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("SUMMARY:Group A: A event");
    expect(body).toContain("SUMMARY:Group A: Serving: Greeters A");
    expect(body).not.toContain("B event");
    expect(body).not.toContain("Greeters B");
    expect(body).not.toContain("Cancelled date");
    expect(predicates.events).toEqual(
      expect.arrayContaining([["eq", { org_id: ORG }], ["in", { group_id: [GROUP_A] }]])
    );
    expect(predicates.serving_signups).toEqual(
      expect.arrayContaining([
        ["eq", { org_id: ORG }],
        ["in", { "teams.group_id": [GROUP_A] }],
        ["eq", { "serving_signup_attendees.profile_id": OWNER }],
      ])
    );
  });

  it("pins a feed to one of the owner's groups without a prefix", async () => {
    const { client } = makeServiceClient({ memberships: memberOfAOnly });
    createServiceClient.mockResolvedValue(client);

    const body = await (await GET(feedRequest(`&group=${GROUP_A}`))).text();

    expect(body).toContain("SUMMARY:A event");
    expect(body).toContain("SUMMARY:Serving: Greeters A");
    expect(body).not.toContain("Group A:");
    expect(body).not.toContain("B event");
  });

  it("returns an empty feed for a group the owner is not in", async () => {
    const { client, predicates } = makeServiceClient({ memberships: memberOfAOnly });
    createServiceClient.mockResolvedValue(client);

    const res = await GET(feedRequest(`&group=${GROUP_B}`));
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).not.toContain("BEGIN:VEVENT");
    expect(predicates.events).toBeUndefined();
    expect(predicates.serving_signups).toBeUndefined();
  });

  it("fails with 500 when the membership read fails, never with an unscoped feed", async () => {
    const { client, predicates } = makeServiceClient({ memberships: "error" });
    createServiceClient.mockResolvedValue(client);

    const res = await GET(feedRequest());

    expect(res.status).toBe(500);
    expect(predicates.events).toBeUndefined();
  });

  it("lists every date of a series that began before the window, without the deleted date", async () => {
    const { client } = makeServiceClient({ memberships: memberOfAOnly });
    createServiceClient.mockResolvedValue(client);

    const body = await (await GET(feedRequest())).text();
    const deletedDay = seriesDateNear(SOON).slice(0, 10);
    const studyUids = body.match(/UID:study-a-\d{4}-\d{2}-\d{2}/g) ?? [];

    // 2026-10-05 to 2027-11-04 holds 56 Sundays; the deleted date and the two
    // moved ones each take one.
    expect(studyUids.length).toBe(53);
    expect(new Set(studyUids).size).toBe(studyUids.length);
    expect(body).not.toContain(`UID:study-a-${deletedDay}`);
    expect(body).not.toContain("UID:deleted-a");
    // The moved date replaces its slot in the series.
    const movedFrom = seriesDateNear(new Date(Date.parse(SOON) + 7 * DAY).toISOString()).slice(0, 10);
    expect(body).not.toContain(`UID:study-a-${movedFrom}`);
    // So does one moved past the window, which is itself left out.
    const movedFarFrom = seriesDateNear(new Date(Date.parse(SOON) + 21 * DAY).toISOString()).slice(0, 10);
    expect(body).not.toContain(`UID:study-a-${movedFarFrom}`);
    expect(body).not.toContain("UID:moved-far");
    expect(body).not.toContain("Other study");
  });

  it("gives a moved date its series' meeting", async () => {
    const { client } = makeServiceClient({ memberships: memberOfAOnly });
    createServiceClient.mockResolvedValue(client);

    const body = await (await GET(feedRequest())).text();
    const moved = body.split("BEGIN:VEVENT").find((v) => v.includes("UID:moved-a"));

    expect(moved).toContain("Moved study");
    expect(moved).toContain("Meeting ID: 111 222 3333");
    expect(body).not.toContain("999 888 7777");
  });

  it("reads every page of events, not just the first", async () => {
    const many = Array.from({ length: 1200 }, (_, i) => event(`one-off-${i}`, GROUP_A, `One-off ${i}`));
    const { client } = makeServiceClient({ memberships: memberOfAOnly, extraEvents: many });
    createServiceClient.mockResolvedValue(client);

    const body = await (await GET(feedRequest())).text();

    expect(body).toContain("UID:one-off-0\r\n");
    expect(body).toContain("UID:one-off-1199\r\n");
    expect(body).toContain("UID:moved-a");
  });
});
