import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { ActiveGroup } from "@/lib/groups/active";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";

type Read = { data: unknown; error: { code: string; message: string } | null; count?: number };

const FAILED: Read = { data: null, error: { code: "57014", message: "timeout" } };

let reads: Record<string, Read | ((filters: Record<string, unknown>) => Read)>;
let filtersByTable: Record<string, Record<string, unknown>[]>;
let zone: string;

/** A query builder whose every call chains, resolving to the table's canned read; `eq` and `gte` arguments are recorded per chain. */
function query(table: string) {
  const filters: Record<string, unknown> = {};
  (filtersByTable[table] ??= []).push(filters);
  const builder: Record<string, unknown> = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === "then") {
          const read = reads[table] ?? { data: [], error: null };
          const result = typeof read === "function" ? read(filters) : read;
          return (resolve: (r: Read) => unknown) => Promise.resolve(result).then(resolve);
        }
        if (prop === "eq" || prop === "gte") {
          return (column: string, value: unknown) => {
            filters[`${String(prop)}:${column}`] = value;
            return builder;
          };
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
vi.mock("@/lib/time/orgZone", () => ({ getOrgTimeZone: async () => zone }));
vi.mock("@/components/states/ErrorState", () => ({ ErrorState: () => null }));
vi.mock("@/components/events/RsvpControl", () => ({ RsvpControl: () => null }));
vi.mock("@/components/groups/home/StartingNowPanel", () => ({ StartingNowPanel: () => null }));
vi.mock("@/components/groups/home/HomePrayerCard", () => ({ HomePrayerCard: () => null }));

const { default: Link } = await import("next/link");
const { ErrorState } = await import("@/components/states/ErrorState");
const { RsvpControl } = await import("@/components/events/RsvpControl");
const { StartingNowPanel } = await import("@/components/groups/home/StartingNowPanel");
const { HomePrayerCard } = await import("@/components/groups/home/HomePrayerCard");
const { GroupDashboard } = await import("./GroupDashboard");

const MEMBER: ActiveGroup = { id: "b", name: "Hope", color: GROUP_DEFAULT_COLOR, role: "member" };
const LEADER: ActiveGroup = { ...MEMBER, role: "leader" };

const STUBS = new Set<unknown>([ErrorState, Link, RsvpControl, StartingNowPanel, HomePrayerCard]);

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

/** Every element of `type` in the tree, by its props. */
function propsOf<P>(node: ReactNode, type: unknown, out: P[] = []): P[] {
  if (Array.isArray(node)) {
    node.forEach((n) => propsOf(n, type, out));
    return out;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return out;
  const element = node as ReactElement<P & { children?: ReactNode }>;
  if (element.type === type) out.push(element.props);
  propsOf(element.props.children, type, out);
  return out;
}

/** Link text beside its href, for asserting where a row opens. */
function linkHrefs(node: ReactNode): string[] {
  return propsOf<{ href: string }>(node, Link).map((l) => l.href);
}

async function render(group: ActiveGroup = MEMBER) {
  return expand(await GroupDashboard({ group }));
}

const NOW = new Date("2026-11-03T14:00:00Z");
const ORG = "org-1";
const weeklyEvent = {
  id: "e1",
  group_id: "b",
  title: "Sunday morning",
  start_time: "2026-10-04T13:30:00Z",
  end_time: null,
  location: "Room 204",
  is_rsvp_enabled: true,
  recurrence_frequency: "weekly",
  recurrence_interval: 1,
  recurrence_end_mode: "never",
  series_id: null,
  meeting_url: null,
  meeting_id: null,
  meeting_show_on_dashboard: true,
  meeting_lead_minutes: 15,
};
const oneTimeEvent = {
  ...weeklyEvent,
  id: "e2",
  title: "Fall potluck",
  start_time: "2026-11-07T22:30:00Z",
  location: "The Okafors' home",
  recurrence_frequency: null,
  recurrence_end_mode: null,
};
const openPrayer = {
  id: "p1",
  body: "Pray for the move",
  is_anonymous: true,
  is_answered: false,
  mine: false,
  praying_count: 2,
  i_am_praying: false,
  created_at: "2026-11-02T14:00:00Z",
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
  zone = "America/New_York";
  filtersByTable = {};
  reads = {
    profiles: { data: { org_id: ORG, preferred_name: null, first_name: "Ann" }, error: null },
    lectures: { data: null, error: null, count: 0 },
    group_join_requests: { data: null, error: null, count: 0 },
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GroupDashboard", () => {
  it("greets by name above the group's name and the date", async () => {
    const text = texts(await render()).join("");
    expect(text).toContain("Ann");
    expect(text).toContain("Hope · Tuesday, November 3");
  });

  it("greets without a stand-in name when the profile has none", async () => {
    reads.profiles = { data: { org_id: ORG, preferred_name: null, first_name: null }, error: null };

    const text = texts(await render()).join("");

    expect(text).not.toContain("Friend");
    expect(text).toMatch(/Good (morning|afternoon|evening)\./);
  });

  it("reports the page as failed when the viewer's org can't be read, and asks for nothing else", async () => {
    reads.profiles = FAILED;

    const tree = await render();

    expect(failedSections(tree)).toEqual(["Home"]);
    expect(Object.keys(filtersByTable)).toEqual(["profiles"]);
  });

  it("filters every read on the viewer's org", async () => {
    await render(LEADER);
    for (const [table, chains] of Object.entries(filtersByTable)) {
      if (table === "profiles") continue;
      for (const filters of chains) expect(filters["eq:org_id"], table).toBe(ORG);
    }
  });

  it("keeps the empty states for a group with nothing at all, with the add actions for a leader only", async () => {
    const leader = await render(LEADER);
    const leaderText = texts(leader).join("");
    const memberText = texts(await render(MEMBER)).join("");

    for (const text of [leaderText, memberText]) {
      expect(text).toContain("No upcoming events.");
      expect(text).toContain("No announcements yet.");
      expect(text).toContain("No prayer requests yet.");
    }
    expect(leaderText).toContain("Add event");
    expect(leaderText).toContain("Add announcement");
    expect(memberText).not.toContain("Add event");
    expect(memberText).not.toContain("Add announcement");
    expect(failedSections(leader)).toEqual([]);
  });

  it("shows a quiet week with only what exists, and no empty boxes", async () => {
    reads.events = { data: [weeklyEvent], error: null };

    const text = texts(await render()).join("");

    expect(text).toContain("This week");
    expect(text).toContain("Sunday morning");
    expect(text).not.toContain("New in the group");
    expect(text).not.toContain("Prayer");
    expect(text).not.toContain("To do");
    expect(text).not.toContain("No upcoming events.");
  });

  it("keeps a leader's add action where a section is empty", async () => {
    reads.events = { data: [weeklyEvent], error: null };

    const tree = await render(LEADER);

    expect(texts(tree).join("")).toContain("Add announcement");
    expect(linkHrefs(tree)).toContain("/g/b/settings/announcements/new");
  });

  it("offers a leader Add event when only the week is empty", async () => {
    reads.prayer_wall = { data: [openPrayer], error: null };

    const tree = await render(LEADER);

    expect(texts(tree).join("")).toContain("Add event");
    expect(linkHrefs(tree)).toContain("/g/b/calendar/new");
  });

  it("gives reply buttons to a one-time event with RSVPs on, and none to a weekly one", async () => {
    reads.events = { data: [weeklyEvent, oneTimeEvent], error: null };
    reads.rsvps = { data: [{ event_id: "e2", status: "yes" }], error: null };

    const tree = await render();
    const replies = propsOf<{ eventId: string; currentStatus: string; tone: string }>(tree, RsvpControl);

    expect(replies).toEqual([
      expect.objectContaining({ eventId: "e2", currentStatus: "yes", tone: "quiet" }),
    ]);
    expect(texts(tree).join("")).toContain("5:30 PM · The Okafors' home");
  });

  it("asks nothing of an event with RSVPs off", async () => {
    reads.events = { data: [{ ...oneTimeEvent, is_rsvp_enabled: false }], error: null };

    expect(propsOf(await render(), RsvpControl)).toEqual([]);
  });

  it("says You're serving on the matching event", async () => {
    reads.events = { data: [weeklyEvent], error: null };
    reads.serving_signups = {
      data: [
        {
          team_id: "t1",
          service_date: "2026-11-08",
          teams: { name: "Greeters" },
          serving_signup_attendees: [{ profile_id: "user-1" }],
        },
      ],
      error: null,
    };

    expect(texts(await render()).join("")).toContain("You're serving");
  });

  it("takes serving dates from today in the church's time zone", async () => {
    vi.setSystemTime(new Date("2026-11-02T02:30:00Z"));

    await render();
    expect(filtersByTable.serving_signups[0]["gte:service_date"]).toBe("2026-11-01");

    zone = "UTC";
    filtersByTable = {};
    await render();
    expect(filtersByTable.serving_signups[0]["gte:service_date"]).toBe("2026-11-02");
  });

  it("asks a member on a team with a Clay link, and opens the team's schedule", async () => {
    reads.serving_team_settings = {
      data: [{ team_id: "t1", window_weeks: 4, teams: { name: "Greeters" } }],
      error: null,
    };
    reads.team_members = { data: [{ team_id: "t1" }], error: null };

    const tree = await render();
    const text = texts(tree).join("");

    expect(text).toContain("Greeters needs people");
    expect(text).toContain("4 open dates · next is Sun, Nov 8");
    expect(linkHrefs(tree)).toContain("/g/b/serving/t1");
    expect(text).not.toContain("You're signed up");
  });

  it("shows the check instead of the ask once they're on a date", async () => {
    reads.serving_team_settings = {
      data: [{ team_id: "t1", window_weeks: 4, teams: { name: "Greeters" } }],
      error: null,
    };
    reads.team_members = { data: [{ team_id: "t1" }], error: null };
    reads.serving_signups = {
      data: [
        {
          team_id: "t1",
          service_date: "2026-11-15",
          teams: { name: "Greeters" },
          serving_signup_attendees: [{ profile_id: "user-1" }],
        },
      ],
      error: null,
    };

    const tree = await render();
    const text = texts(tree).join("");

    expect(text).toContain("You're signed up");
    expect(text).toContain("See open dates");
    expect(text).not.toContain("next is");
  });

  it("shows To do to a leader with each row's page, and never to a member", async () => {
    const waiting = () => {
      reads.group_join_requests = { data: null, error: null, count: 2 };
      reads.announcements = (filters) =>
        filters["eq:is_published"] === false
          ? { data: [{ id: "d1", title: "Meal train" }], error: null }
          : { data: [], error: null };
    };
    waiting();

    const leader = await render(LEADER);
    const leaderText = texts(leader).join("");
    expect(leaderText).toContain("To do");
    expect(leaderText).toContain("2 people asked to join");
    expect(leaderText).toContain("1 announcement to publish");
    expect(linkHrefs(leader)).toEqual(
      expect.arrayContaining(["/g/b/settings/privacy", "/g/b/settings/announcements"]),
    );

    expect(texts(await render(MEMBER)).join("")).not.toContain("To do");
  });

  it("passes the newest open request that isn't yours to the prayer card", async () => {
    reads.prayer_wall = (filters) =>
      filters["eq:is_answered"] === false ? { data: [openPrayer], error: null } : { data: [], error: null };

    const tree = await render();
    const cards = propsOf<{ request: { id: string } }>(tree, HomePrayerCard);

    expect(cards.map((c) => c.request.id)).toEqual(["p1"]);
    expect(filtersByTable.prayer_wall.at(-1)).toMatchObject({
      "eq:mine": false,
      "eq:i_am_praying": false,
    });
  });

  it("reads the answered time from prayer_requests and the text from the wall", async () => {
    reads.prayer_requests = {
      data: [{ id: "p2", updated_at: "2026-11-02T14:00:00Z" }],
      error: null,
    };
    reads.prayer_wall = (filters) =>
      filters["eq:is_answered"] === false
        ? { data: [], error: null }
        : {
            data: [{ id: "p2", body: "Eli arrived safely.", is_anonymous: true }],
            error: null,
          };

    const text = texts(await render()).join("");

    expect(text).toContain("Prayer answered · Yesterday");
    expect(text).toContain("Eli arrived safely.");
    expect(text).not.toContain("Anonymous");
  });

  it("opens the join panel during the window, with the recording link when there are lessons", async () => {
    reads.events = {
      data: [
        {
          ...oneTimeEvent,
          start_time: "2026-11-03T14:10:00Z",
          meeting_url: "https://zoom.us/j/1",
          title: "Prayer call",
        },
      ],
      error: null,
    };
    reads.lectures = (filters) =>
      "eq:group_id" in filters ? { data: [], error: null, count: 2 } : { data: [], error: null };

    const [panel] = propsOf<{ event: { title: string }; recordingsHref: string | null }>(
      await render(),
      StartingNowPanel,
    );

    expect(panel.event.title).toBe("Prayer call");
    expect(panel.recordingsHref).toBe("/g/b/lectures");
  });
});

describe("GroupDashboard's failed reads", () => {
  const someContent = () => {
    reads.events = { data: [weeklyEvent], error: null };
    reads.prayer_wall = { data: [openPrayer], error: null };
  };

  it.each([
    ["events", "this week's events"],
    ["rsvps", "this week's events"],
    ["profiles_directory", "birthdays and anniversaries"],
    ["families_directory_full", "birthdays and anniversaries"],
    ["prayer_wall", "prayer requests"],
    ["serving_signups", "serving dates"],
    ["serving_team_settings", "serving dates"],
    ["team_members", "serving dates"],
    ["lectures", "what's new in the group"],
    ["announcements", "what's new in the group"],
    ["prayer_requests", "what's new in the group"],
  ])("shows a failed %s read as a failed section, not an empty one", async (table, thing) => {
    someContent();
    reads[table] = FAILED;

    const tree = await render();
    const text = texts(tree).join("");

    expect(failedSections(tree)).toContain(thing);
    expect(text).not.toContain("No upcoming events.");
    expect(text).not.toContain("No announcements yet.");
  });

  it("reports a failed roster in both sections that need it", async () => {
    reads.group_members = FAILED;

    expect(failedSections(await render())).toEqual([
      "birthdays and anniversaries",
      "what's new in the group",
    ]);
  });

  it("keeps the rest of the page when one read fails", async () => {
    someContent();
    reads.announcements = FAILED;

    const tree = await render();

    expect(failedSections(tree)).toEqual(["what's new in the group"]);
    expect(texts(tree).join("")).toContain("Sunday morning");
    expect(propsOf(tree, HomePrayerCard)).toHaveLength(1);
  });

  it.each([
    ["group_join_requests", "your to do list"],
    ["announcements", "your to do list"],
    ["serving_signups", "your to do list"],
  ])("shows a leader's failed %s read as a failed To do", async (table, thing) => {
    someContent();
    reads[table] = FAILED;

    const tree = await render(LEADER);

    expect(failedSections(tree)).toContain(thing);
    expect(texts(tree).join("")).toContain("To do");
  });
});
