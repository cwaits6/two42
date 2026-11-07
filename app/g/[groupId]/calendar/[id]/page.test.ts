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

function from(table: string) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: () => Promise.resolve({ data: table === "events" ? EVENT : null, error: null }),
    or: () => Promise.resolve(rsvps),
    in: () => Promise.resolve(profiles),
  };
  return chain;
}

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
vi.mock("@/components/events/RsvpControl", () => ({ RsvpControl: () => null }));
vi.mock("./_components/AttendeeStrip", () => ({ AttendeeStrip: () => null }));
vi.mock("@/components/events/AddToCalendarButton", () => ({ AddToCalendarButton: () => null }));
vi.mock("@/components/events/EventMap", () => ({ EventMap: () => null }));
vi.mock("@/components/events/SubscribeToEventButton", () => ({ SubscribeToEventButton: () => null }));
vi.mock("@/components/events/JoinMeetingBlock", () => ({ JoinMeetingBlock: () => null }));

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

async function renderedTypes() {
  const element = await EventDetailPage({
    params: Promise.resolve({ groupId: "g1", id: "e1" }),
    searchParams: Promise.resolve({}),
  });
  return flatten(element).map((e) => e.type);
}

const GOING = { event_id: "e1", user_id: "u2", status: "yes", occurrence_date: null };
const PERSON = { id: "u2", first_name: "Ruth", last_name: null, preferred_name: null, avatar_url: null };

beforeEach(() => {
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
