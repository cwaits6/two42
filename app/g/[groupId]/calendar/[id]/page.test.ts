import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

type Result = { data: unknown; error: { code: string; message: string } | null };

const FAILED = { code: "57014", message: "canceling statement" };
const UPCOMING = new Date(Date.now() + 7 * 86400000).toISOString();

let rsvps: Result;
let profiles: Result;

const EVENT = {
  id: "e1",
  group_id: "g1",
  title: "Supper",
  description: null,
  location: null,
  start_time: UPCOMING,
  end_time: null,
  is_rsvp_enabled: true,
  is_cancelled: false,
  recurrence_frequency: null,
  series_id: null,
  series_occurrence_date: null,
  meeting_url: null,
  meeting_id: null,
  meeting_passcode: null,
  meeting_show_on_dashboard: false,
  meeting_lead_minutes: null,
};

// Rows by id, and the dates edited on their own that a series lookup returns.
let events: Record<string, object>;
let edited: Result;
let replyFilter: string | null;
let editedOrder: string[];

function from(table: string) {
  let id: string | null = null;
  const chain = {
    select: () => chain,
    eq: (column: string, value: string) => {
      if (column === "id") id = value;
      return chain;
    },
    order: (column: string) => {
      editedOrder.push(column);
      return chain;
    },
    maybeSingle: () =>
      Promise.resolve({ data: table === "events" && id ? (events[id] ?? null) : null, error: null }),
    or: (filter: string) => {
      replyFilter = filter;
      return Promise.resolve(rsvps);
    },
    in: () => Promise.resolve(profiles),
    then: (resolve: (r: Result) => unknown) => resolve(edited),
  };
  return chain;
}

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
  redirect: (path: string) => {
    throw new Error(`redirect ${path}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }));
vi.mock("@/lib/groups/server", () => ({
  requireActiveGroup: async (id: string) => ({ id, name: "Grace", role: "member" }),
}));
vi.mock("@/lib/supabase/current-user", () => ({
  getOptionalUser: async () => ({ id: "u1", email: undefined }),
}));
vi.mock("@/lib/time/orgZone", () => ({ getOrgTimeZone: async () => "America/New_York" }));
vi.mock("@/lib/storageRead", () => ({
  mintSignedUrls: async (urls: (string | null)[]) => urls,
}));
vi.mock("@/components/states/ErrorState", () => ({ ErrorState: () => null }));
vi.mock("@/components/events/RsvpControl", () => ({ RsvpControl: function RsvpControl() { return null; } }));
vi.mock("./_components/AttendeeStrip", () => ({ AttendeeStrip: () => null }));
vi.mock("@/components/events/AddToCalendarButton", () => ({ AddToCalendarButton: () => null }));
vi.mock("@/components/events/EventMap", () => ({ EventMap: () => null }));
vi.mock("@/components/events/SubscribeToEventButton", () => ({ SubscribeToEventButton: () => null }));
vi.mock("@/components/events/JoinMeetingBlock", () => ({ JoinMeetingBlock: () => null }));

const { dayKey } = await import("@/lib/time/zone");
const { ErrorState } = await import("@/components/states/ErrorState");
const { RsvpControl } = await import("@/components/events/RsvpControl");
const { AttendeeStrip } = await import("./_components/AttendeeStrip");
const { default: EventDetailPage } = await import("./page");

function flatten(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) {
    node.forEach((n) => flatten(n, out));
    return out;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return out;
  const element = node as ReactElement<{ children?: ReactNode }>;
  out.push(element);
  flatten(element.props.children, out);
  return out;
}

async function render(id = "e1", occurrence?: string) {
  const element = await EventDetailPage({
    params: Promise.resolve({ groupId: "g1", id }),
    searchParams: Promise.resolve(occurrence ? { occurrence } : {}),
  });
  return flatten(element);
}

async function renderedTypes() {
  return (await render()).map((e) => e.type);
}

async function replyProps(id: string, occurrence?: string) {
  const control = (await render(id, occurrence)).find((e) => e.type === RsvpControl);
  return control?.props as { eventId: string; occurrenceDate: string } | undefined;
}

// A weekly series of Sunday mornings in New York, with the 8 days-out Sunday
// moved to Monday evening on its own.
const SERIES_START = new Date(Date.now() + 86400000);
const SUNDAY = new Date(SERIES_START.getTime() + 7 * 86400000).toISOString();
const SERIES = {
  ...EVENT,
  id: "s1",
  start_time: SERIES_START.toISOString(),
  recurrence_frequency: "weekly",
};
const EDITED = {
  ...EVENT,
  id: "x1",
  start_time: new Date(Date.parse(SUNDAY) + 34 * 3600000).toISOString(),
  series_id: "s1",
  series_occurrence_date: SUNDAY,
};
const SUNDAY_DAY = dayKey(SUNDAY, "America/New_York");

const GOING = { event_id: "e1", user_id: "u2", status: "yes", occurrence_date: null };
const PERSON = { id: "u2", first_name: "Ruth", last_name: null, preferred_name: null, avatar_url: null };

beforeEach(() => {
  events = { e1: EVENT, s1: SERIES, x1: EDITED };
  edited = { data: [], error: null };
  replyFilter = null;
  editedOrder = [];
  rsvps = { data: [GOING], error: null };
  profiles = { data: [PERSON], error: null };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("EventDetailPage replies", () => {
  it("asks for a reply and shows who's coming when both reads succeed", async () => {
    const types = await renderedTypes();
    expect(types).toContain(RsvpControl);
    expect(types).toContain(AttendeeStrip);
    expect(types).not.toContain(ErrorState);
  });

  it("shows the replies as unavailable, not as nobody coming, when the replies read fails", async () => {
    rsvps = { data: null, error: FAILED };
    const types = await renderedTypes();
    expect(types).toContain(ErrorState);
    expect(types).not.toContain(RsvpControl);
    expect(types).not.toContain(AttendeeStrip);
  });

  it("shows the replies as unavailable when the read of who's coming fails", async () => {
    profiles = { data: null, error: FAILED };
    const types = await renderedTypes();
    expect(types).toContain(ErrorState);
    expect(types).not.toContain(RsvpControl);
    expect(types).not.toContain(AttendeeStrip);
  });
});

describe("EventDetailPage reply date", () => {
  it("answers a date edited on its own through its series and its series day", async () => {
    expect(await replyProps("x1")).toMatchObject({ eventId: "s1", occurrenceDate: SUNDAY_DAY });
    expect(replyFilter).toContain("event_id.eq.x1");
  });

  it("sends a series date that was edited on its own to the edited date's page", async () => {
    edited = { data: [{ id: "x1", series_occurrence_date: SUNDAY }], error: null };
    await expect(render("s1", SUNDAY)).rejects.toThrow("redirect /g/g1/calendar/x1");
    expect(editedOrder).toEqual(["created_at", "id"]);
  });

  // 20:30 in New York is the next day in UTC, so only a match by the church's
  // day sends this date to its edited page and leaves the next day's alone.
  const LATE_EVENING = "2030-01-06T01:30:00.000Z";

  it("matches an edited late-evening date by its day in the church's zone", async () => {
    edited = { data: [{ id: "x1", series_occurrence_date: LATE_EVENING }], error: null };
    await expect(render("s1", LATE_EVENING)).rejects.toThrow("redirect /g/g1/calendar/x1");
  });

  it("leaves a late-evening date alone when the edited row is on the next day in the church's zone", async () => {
    edited = { data: [{ id: "x1", series_occurrence_date: "2030-01-06T15:00:00.000Z" }], error: null };
    await expect(render("s1", LATE_EVENING)).resolves.toBeDefined();
  });

  it("answers a series date nobody edited through the series and that date's day", async () => {
    edited = { data: [{ id: "x1", series_occurrence_date: SERIES_START.toISOString() }], error: null };
    expect(await replyProps("s1", SUNDAY)).toMatchObject({ eventId: "s1", occurrenceDate: SUNDAY_DAY });
    expect(replyFilter).not.toContain("x1");
  });

  it("shows the replies as unavailable when the series' edited dates can't be read", async () => {
    edited = { data: null, error: FAILED };
    const types = (await render("s1", SUNDAY)).map((e) => e.type);
    expect(types).toContain(ErrorState);
    expect(types).not.toContain(RsvpControl);
  });

  it("shows no replies error when that read fails on a series that takes no replies", async () => {
    events.s1 = { ...SERIES, is_rsvp_enabled: false };
    edited = { data: null, error: FAILED };
    const types = (await render("s1", SUNDAY)).map((e) => e.type);
    expect(types).not.toContain(ErrorState);
    expect(types).not.toContain(RsvpControl);
  });
});
