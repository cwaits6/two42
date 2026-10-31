import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { ActiveGroup } from "@/lib/groups/active";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";

type Read = { data: unknown; error: { code: string; message: string } | null; count?: number };

const FAILED: Read = { data: null, error: { code: "57014", message: "timeout" } };

let reads: Record<string, Read>;

/** A query builder whose every call chains, resolving to the table's canned read. */
function query(table: string) {
  const builder: Record<string, unknown> = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "then") {
          return (resolve: (r: Read) => unknown) => resolve(reads[table] ?? { data: [], error: null });
        }
        return () => builder;
      },
    }
  );
  return builder;
}

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: query }) }));
vi.mock("@/lib/supabase/current-user", () => ({ getOptionalUser: async () => ({ id: "user-1" }) }));
vi.mock("@/lib/time/orgZone", () => ({ getOrgTimeZone: async () => "America/New_York" }));
vi.mock("@/components/states/ErrorState", () => ({ ErrorState: () => null }));
vi.mock("@/components/groups/RsvpSegmented", () => ({ RsvpSegmented: () => null }));
vi.mock("@/components/events/JoinMeetingBlock", () => ({ JoinMeetingBlock: () => null }));

const { default: Link } = await import("next/link");
const { ErrorState } = await import("@/components/states/ErrorState");
const { GroupDashboard } = await import("./GroupDashboard");

const MEMBER: ActiveGroup = { id: "b", name: "Hope", color: GROUP_DEFAULT_COLOR, role: "member" };
const LEADER: ActiveGroup = { ...MEMBER, role: "leader" };

const STUBS = new Set<unknown>([ErrorState, Link]);

/** Renders nested server components so the whole page's text is visible; stubs stay as elements. */
function expand(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(expand);
  if (!node || typeof node !== "object" || !("props" in node)) return node;
  const element = node as ReactElement<{ children?: ReactNode; action?: ReactNode; title?: ReactNode }>;
  if (typeof element.type === "function" && !STUBS.has(element.type)) {
    const Component = element.type as (props: unknown) => ReactNode;
    return expand(Component(element.props));
  }
  return { ...element, props: { ...element.props, children: expand(element.props.children) } };
}

function texts(node: ReactNode, out: string[] = []): string[] {
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => texts(n, out));
    return out;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return out;
  texts((node as ReactElement<{ children?: ReactNode }>).props.children, out);
  return out;
}

function failedSections(node: ReactNode, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((n) => failedSections(n, out));
    return out;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return out;
  const element = node as ReactElement<{ thing?: string; children?: ReactNode }>;
  if (element.type === ErrorState) out.push(element.props.thing ?? "");
  failedSections(element.props.children, out);
  return out;
}

async function render(group: ActiveGroup = MEMBER) {
  return expand(await GroupDashboard({ group }));
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  reads = {
    profiles: { data: { preferred_name: null, first_name: "Ann" }, error: null },
    events: { data: [], error: null },
    rsvps: { data: [], error: null },
    lectures: { data: null, error: null, count: 0 },
    announcements: {
      data: [{ id: "a1", title: "Potluck sign-up", content: "Bring a dish", published_at: null, created_at: new Date().toISOString() }],
      error: null,
    },
    prayer_wall: {
      data: [{ id: "p1", body: "Pray for the move", is_anonymous: true, first_name: null, last_name: null, preferred_name: null, created_at: new Date().toISOString() }],
      error: null,
    },
    serving_signups: { data: [], error: null },
  };
});

describe("GroupDashboard", () => {
  it("shows a failed announcements read as an error while the other sections still render", async () => {
    reads.announcements = FAILED;

    const tree = await render();
    const text = texts(tree).join("");

    expect(failedSections(tree)).toEqual(["announcements"]);
    expect(text).not.toContain("No announcements yet.");
    expect(text).toContain("Pray for the move");
    expect(text).toContain("No upcoming events.");
    expect(text).toContain("Good");
  });

  it("shows a failed events read as an error, not as no upcoming events", async () => {
    reads.events = FAILED;

    const tree = await render();
    const text = texts(tree).join("");

    expect(failedSections(tree)).toEqual(["upcoming events"]);
    expect(text).not.toContain("No upcoming events.");
    expect(text).toContain("Potluck sign-up");
  });

  it("shows a failed RSVP read as an events error, not as no replies", async () => {
    reads.rsvps = FAILED;

    const tree = await render();
    const text = texts(tree).join("");

    expect(failedSections(tree)).toEqual(["upcoming events"]);
    expect(text).not.toContain("No upcoming events.");
    expect(text).toContain("Potluck sign-up");
  });

  it("lists a serving turn by team name with the date written out", async () => {
    reads.serving_signups = {
      data: [{ id: "s1", service_date: "2026-11-01", team_id: "t1", teams: { id: "t1", name: "Coffee team" } }],
      error: null,
    };

    const tree = await render();
    const text = texts(tree).join("");

    expect(failedSections(tree)).toEqual([]);
    expect(text).toContain("Your turn to serve");
    expect(text).toContain("Coffee team");
    expect(text).toContain("Sunday, November 1");
    expect(text).not.toContain("2026-11-01");
  });

  it("shows a failed serving read under its own heading", async () => {
    reads.serving_signups = FAILED;

    const tree = await render();

    expect(failedSections(tree)).toEqual(["your serving turns"]);
    expect(texts(tree).join("")).toContain("Your turn to serve");
  });

  it("offers Add event and Add announcement in the empty states to a leader only", async () => {
    reads.announcements = { data: [], error: null };

    const leader = texts(await render(LEADER)).join("");
    const member = texts(await render(MEMBER)).join("");

    expect(leader).toContain("Add event");
    expect(leader).toContain("Add announcement");
    expect(member).toContain("No announcements yet.");
    expect(member).not.toContain("Add event");
    expect(member).not.toContain("Add announcement");
  });

  it("greets without a stand-in name when the profile has none", async () => {
    reads.profiles = { data: { preferred_name: null, first_name: null }, error: null };

    const text = texts(await render()).join("");

    expect(text).not.toContain("Friend");
    expect(text).toMatch(/Good (morning|afternoon|evening)\./);
  });
});
