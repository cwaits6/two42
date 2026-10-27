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
    gte: () => obj,
    order: () => obj,
    limit: () => obj,
    then: (resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve({
        data: rows.filter((row) => filters.every((f) => f(row))),
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

function event(id: string, groupId: string, title: string): Row {
  return {
    id,
    org_id: ORG,
    group_id: groupId,
    title,
    description: null,
    location: null,
    start_time: "2030-01-05T15:00:00.000Z",
    end_time: null,
    is_cancelled: false,
  };
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

function makeServiceClient(opts: { memberships: Row[] | "error" }) {
  const predicates: Record<string, Array<[string, unknown]>> = {};
  const record = (table: string) => (filter: [string, unknown]) => {
    (predicates[table] ??= []).push(filter);
  };
  const events = [
    event("event-a", GROUP_A, "A event"),
    event("event-b", GROUP_B, "B event"),
    { ...event("event-x", GROUP_A, "Cancelled date"), is_cancelled: true },
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
});
