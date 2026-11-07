import { describe, expect, it } from "vitest";
import {
  announcementText,
  buildGroupHome,
  dateNotices,
  joinedNames,
  namesLine,
  needsMoreDates,
  newTiles,
  servingCards,
  teamCoverage,
  tileAge,
  type AnsweredPrayerRow,
  type GroupHomeReads,
  type HomeContext,
  type LessonRow,
  type ServingSignupRow,
  type ServingTeamRow,
} from "@/lib/groups/groupHome";
import type { DirectoryProfile, Event, FamilyDirectoryFull, PrayerWallRow, Rsvp } from "@/lib/types";

const ZONE = "America/New_York";
// Tuesday, Nov 3, 2026, 9:00 AM in New York.
const NOW = new Date("2026-11-03T14:00:00Z");
const TODAY = "2026-11-03";
const GROUP = "g1";
const USER = "me";

const ctx = (over: Partial<HomeContext> = {}): HomeContext => ({
  groupId: GROUP,
  isLeader: false,
  userId: USER,
  timeZone: ZONE,
  now: NOW,
  ...over,
});

function event(over: Partial<Event> & { id: string; start_time: string }): Event {
  return {
    group_id: GROUP,
    title: over.id,
    description: null,
    location: null,
    end_time: null,
    is_rsvp_enabled: true,
    recurrence_frequency: null,
    recurrence_interval: 1,
    recurrence_end_mode: null,
    recurrence_count: null,
    recurrence_until: null,
    series_id: null,
    series_occurrence_date: null,
    meeting_url: null,
    meeting_id: null,
    meeting_passcode: null,
    meeting_show_on_dashboard: true,
    meeting_lead_minutes: 15,
    is_cancelled: false,
    ...over,
  } as Event;
}

// Sundays at 9:30 AM New York, anchored on Oct 4.
const SUNDAYS = event({
  id: "sundays",
  title: "Sunday morning",
  start_time: "2026-10-04T13:30:00Z",
  location: "Room 204",
  recurrence_frequency: "weekly",
  recurrence_end_mode: "never",
});
const NOV_8 = "2026-11-08T14:30:00.000Z";
const NOV_15 = "2026-11-15T14:30:00.000Z";

const cancelled = (start: string, over: Partial<Event> = {}) =>
  event({
    id: `cancelled-${start}`,
    title: "Sunday morning",
    start_time: start,
    series_id: "sundays",
    series_occurrence_date: start,
    is_cancelled: true,
    ...over,
  });

const moved = (original: string, over: Partial<Event>) =>
  event({
    id: `moved-${original}`,
    title: "Sunday morning",
    start_time: original,
    location: "Room 204",
    series_id: "sundays",
    series_occurrence_date: original,
    ...over,
  });

function reads(over: Partial<GroupHomeReads> = {}): GroupHomeReads {
  return {
    events: [],
    rsvps: [],
    lessonCount: 0,
    members: [],
    families: [],
    roster: [],
    servingTeams: [],
    myTeamIds: [],
    myLeadTeamIds: [],
    signups: [],
    pendingJoinCount: 0,
    drafts: [],
    lessons: [],
    announcements: [],
    answeredPrayers: [],
    hasOpenPrayer: false,
    openPrayers: [],
    ...over,
  };
}

const person = (over: Partial<DirectoryProfile> & { id: string }) =>
  ({
    first_name: over.id,
    last_name: "Alvarez",
    preferred_name: null,
    family_id: null,
    birth_month: null,
    birth_day: null,
    avatar_url: null,
    ...over,
  }) as DirectoryProfile;

const team = (id: string, weeks = 4): ServingTeamRow => ({
  team_id: id,
  schedule: "rolling",
  window_weeks: weeks,
  date_from: null,
  date_to: null,
  teams: { name: id },
});

const block = (id: string, date_to: string): ServingTeamRow => ({
  ...team(id),
  schedule: "set",
  date_from: "2026-10-11",
  date_to,
});
const signup = (teamId: string, date: string, attendees: string[] = ["someone"]): ServingSignupRow => ({
  team_id: teamId,
  service_date: date,
  teams: { name: teamId },
  serving_signup_attendees: attendees.map((profile_id) => ({ profile_id })),
});

describe("dateNotices", () => {
  it("names a deleted date and the next one in the church's time zone", () => {
    const [notice] = dateNotices([SUNDAYS, cancelled(NOV_8)], ctx());
    expect(notice).toMatchObject({
      kind: "skipped",
      title: "No Sunday morning on Nov 8",
      detail: "The next one is Sun, Nov 15 at 9:30 AM.",
    });
    expect(notice.href).toBe(
      `/g/${GROUP}/calendar/sundays?occurrence=${encodeURIComponent(NOV_15)}`,
    );
  });

  it("leaves out the second line and links the series when there is no later date", () => {
    const ended = event({
      ...SUNDAYS,
      recurrence_end_mode: "until",
      recurrence_until: "2026-11-08T23:00:00Z",
    });
    const [notice] = dateNotices([ended, cancelled(NOV_8)], ctx());
    expect(notice.detail).toBeNull();
    expect(notice.href).toBe(`/g/${GROUP}/calendar/sundays`);
  });

  it("drops a deleted date that has passed or is more than 7 days away", () => {
    const passed = cancelled("2026-11-01T14:30:00.000Z");
    expect(dateNotices([SUNDAYS, passed, cancelled(NOV_15)], ctx())).toEqual([]);
  });

  it("says where a moved date went", () => {
    const [notice] = dateNotices(
      [SUNDAYS, moved(NOV_8, { location: "Fellowship Hall" })],
      ctx(),
    );
    expect(notice).toMatchObject({
      kind: "moved",
      title: "Sunday morning on Nov 8 moves",
      detail: "It's in Fellowship Hall, not Room 204.",
      href: `/g/${GROUP}/calendar/moved-${NOV_8}`,
    });
  });

  it("says when a moved date's time changed, and its place as well", () => {
    const later = "2026-11-08T15:30:00.000Z";
    expect(dateNotices([SUNDAYS, moved(NOV_8, { start_time: later })], ctx())[0].detail).toBe(
      "It's at 10:30 AM, not 9:30 AM.",
    );
    expect(
      dateNotices([SUNDAYS, moved(NOV_8, { start_time: later, location: "Hall" })], ctx())[0].detail,
    ).toBe("It's at 10:30 AM in Hall, not 9:30 AM in Room 204.");
  });

  it("names the date when a moved date lands on another day", () => {
    const monday = "2026-11-09T14:30:00.000Z";
    expect(dateNotices([SUNDAYS, moved(NOV_8, { start_time: monday })], ctx())[0].detail).toBe(
      "It's on Mon, Nov 9 at 9:30 AM, not Sun, Nov 8.",
    );
  });

  it("says so when a moved date loses its place", () => {
    expect(dateNotices([SUNDAYS, moved(NOV_8, { location: null })], ctx())[0].detail).toBe(
      "It's no longer in Room 204.",
    );
  });

  it("does not call a title-only edit a move", () => {
    expect(dateNotices([SUNDAYS, moved(NOV_8, { title: "Harvest Sunday" })], ctx())).toEqual([]);
  });

  it("reads a move's time across the clock change, keeping the series' wall clock", () => {
    // The anchor sits in daylight time; Nov 8 at 9:30 AM New York is in standard time.
    expect(dateNotices([SUNDAYS, moved(NOV_8, {})], ctx())).toEqual([]);
  });

  it("keeps a moved date on notice while its old date is still ahead, even when the new one is far off", () => {
    const farOff = "2026-12-06T14:30:00.000Z";
    const notices = dateNotices([SUNDAYS, moved(NOV_8, { start_time: farOff })], ctx());
    expect(notices).toHaveLength(1);
  });

  it("shows a moved date whose new date is in the window but old date is not", () => {
    const notices = dateNotices(
      [SUNDAYS, moved("2026-11-15T14:30:00.000Z", { start_time: "2026-11-05T14:30:00.000Z" })],
      ctx(),
    );
    expect(notices).toHaveLength(1);
  });
});

describe("the Starting now panel", () => {
  const CALL = {
    meeting_url: "https://zoom.us/j/1",
    meeting_lead_minutes: 15,
    title: "Call",
  };

  it("opens at the event's lead time and not before", () => {
    const call = event({ id: "call", start_time: "2026-11-03T14:10:00Z", ...CALL });
    const before = buildGroupHome(
      reads({ events: [event({ ...call, start_time: "2026-11-03T14:20:00Z" })] }),
      ctx(),
    );
    expect(before.startingNow).toBeNull();
    expect(buildGroupHome(reads({ events: [call] }), ctx()).startingNow?.meetingUrl).toBe(
      "https://zoom.us/j/1",
    );
  });

  const ended = (hoursAgo: number) =>
    event({
      id: "call",
      start_time: new Date(NOW.getTime() - (hoursAgo + 1) * 3_600_000).toISOString(),
      end_time: new Date(NOW.getTime() - hoursAgo * 3_600_000).toISOString(),
      ...CALL,
    });

  it("stays through the ended grace period when there is a lesson to link to, then goes", () => {
    const withLesson = (hoursAgo: number) =>
      buildGroupHome(reads({ events: [ended(hoursAgo)], lessonCount: 1 }), ctx());
    expect(withLesson(2).startingNow).toMatchObject({
      title: "Call",
      recordingsHref: "/g/g1/lectures",
    });
    expect(withLesson(4).startingNow).toBeNull();
  });

  it("goes as soon as the event ends when there is no lesson to link to", () => {
    const home = buildGroupHome(reads({ events: [ended(2)], lessonCount: 0 }), ctx());
    expect(home.startingNow).toBeNull();
    expect(home.nothingAtAll).toBe(true);
  });

  it("shows a live event whether or not there is a lesson", () => {
    const live = event({ id: "call", start_time: "2026-11-03T14:10:00Z", ...CALL });
    expect(buildGroupHome(reads({ events: [live], lessonCount: 0 }), ctx()).startingNow).toMatchObject({
      title: "Call",
      recordingsHref: null,
    });
  });

  it("shows only an event set to show on Home, and only one with meeting details", () => {
    const start = "2026-11-03T14:10:00Z";
    const hidden = event({ id: "c", start_time: start, ...CALL, meeting_show_on_dashboard: false });
    const noMeeting = event({ id: "c", start_time: start });
    expect(buildGroupHome(reads({ events: [hidden] }), ctx()).startingNow).toBeNull();
    expect(buildGroupHome(reads({ events: [noMeeting] }), ctx()).startingNow).toBeNull();
  });

  it("takes the meeting from the series for a moved date", () => {
    const series = event({
      ...SUNDAYS,
      meeting_url: "https://meet.google.com/a",
      recurrence_frequency: "monthly",
    });
    const exception = moved("2026-11-08T14:30:00.000Z", { start_time: "2026-11-03T14:10:00.000Z" });
    const home = buildGroupHome(reads({ events: [series, exception] }), ctx());
    expect(home.startingNow?.meetingUrl).toBe("https://meet.google.com/a");
  });

  it("prefers a live event to one that has ended, and takes it out of This week", () => {
    const ended = event({
      id: "ended",
      start_time: "2026-11-03T11:00:00Z",
      end_time: "2026-11-03T12:00:00Z",
      ...CALL,
      title: "Ended",
    });
    const live = event({ id: "live", start_time: "2026-11-03T14:10:00Z", ...CALL, title: "Live" });
    const home = buildGroupHome(reads({ events: [ended, live] }), ctx());
    expect(home.startingNow?.title).toBe("Live");
    expect(home.weekRows?.map((r) => r.title)).toEqual([]);
  });
});

describe("This week", () => {
  it("keeps every daily and weekly event quiet, at any interval, with no place or replies", () => {
    for (const [frequency, interval] of [
      ["daily", 1],
      ["weekly", 1],
      ["weekly", 2],
    ] as const) {
      const series = event({
        ...SUNDAYS,
        start_time: "2026-10-11T13:30:00Z",
        recurrence_frequency: frequency,
        recurrence_interval: interval,
      });
      const rows = buildGroupHome(reads({ events: [series] }), ctx()).weekRows ?? [];
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        expect(row.reply).toBeNull();
        expect(row.place).toBeNull();
      }
    }
  });

  it("adds the place and replies to a one-time, monthly and yearly event", () => {
    const start = "2026-11-07T22:30:00Z";
    for (const frequency of [null, "monthly", "yearly"] as const) {
      const e = event({
        id: "potluck",
        start_time: start,
        location: "The Okafors' home",
        recurrence_frequency: frequency,
      });
      const rsvps = [{ event_id: "potluck", user_id: USER, status: "maybe", occurrence_date: "2026-11-07" }] as Rsvp[];
      const [row] = buildGroupHome(reads({ events: [e], rsvps }), ctx()).weekRows ?? [];
      expect(row).toMatchObject({
        weekday: "Sat",
        day: "7",
        time: "5:30 PM",
        place: "The Okafors' home",
        reply: { eventId: "potluck", date: "2026-11-07", status: "maybe" },
      });
    }
  });

  it("shows the reply for this date of a monthly event, not one for another date", () => {
    const monthly = event({ id: "supper", start_time: "2026-10-07T22:30:00Z", recurrence_frequency: "monthly" });
    const reply = (occurrence_date: string | null, user_id = USER) =>
      ({ event_id: "supper", user_id, status: "no", occurrence_date }) as Rsvp;
    const status = (rsvps: Rsvp[]) =>
      buildGroupHome(reads({ events: [monthly], rsvps }), ctx()).weekRows?.[0]?.reply;

    expect(status([reply("2026-12-07")])).toEqual({ eventId: "supper", date: "2026-11-07", status: null });
    expect(status([reply("2026-11-07", "someone-else")])?.status).toBeNull();
    expect(status([reply("2026-11-07")])?.status).toBe("no");
    expect(status([reply(null)])?.status).toBe("no");
  });

  it("saves a moved date of a monthly event against its series and its series day", () => {
    const monthly = event({ id: "supper", start_time: "2026-10-07T22:30:00Z", recurrence_frequency: "monthly" });
    const exception = event({
      id: "moved-supper",
      title: "supper",
      start_time: "2026-11-08T23:00:00Z",
      series_id: "supper",
      series_occurrence_date: "2026-11-07T23:30:00.000Z",
    });
    const rsvps = [{ event_id: "moved-supper", user_id: USER, status: "yes", occurrence_date: "2026-11-07" }] as Rsvp[];
    const rows = buildGroupHome(reads({ events: [monthly, exception], rsvps }), ctx()).weekRows ?? [];
    expect(rows.map((r) => r.reply)).toEqual([{ eventId: "supper", date: "2026-11-07", status: "yes" }]);
  });

  it("asks nothing when RSVPs are off", () => {
    const e = event({ id: "x", start_time: "2026-11-07T22:30:00Z", is_rsvp_enabled: false });
    const [row] = buildGroupHome(reads({ events: [e] }), ctx()).weekRows ?? [];
    expect(row.reply).toBeNull();
  });

  it("keeps a moved date of a weekly event quiet, reading the frequency off its series", () => {
    const exception = moved(NOV_8, { location: "Hall" });
    const rows = buildGroupHome(reads({ events: [SUNDAYS, exception] }), ctx()).weekRows ?? [];
    const row = rows.find((r) => r.key.startsWith("moved"));
    expect(row?.reply).toBeNull();
    expect(row?.place).toBeNull();
  });

  it("covers the next 7 days and no further", () => {
    const rows = (start: string) =>
      buildGroupHome(reads({ events: [event({ id: "e", start_time: start })] }), ctx()).weekRows ?? [];
    expect(rows("2026-11-10T13:59:00Z")).toHaveLength(1);
    expect(rows("2026-11-10T14:01:00Z")).toHaveLength(0);
  });

  it("tags only the earliest event on a date you're serving, in the church's time zone", () => {
    const early = event({ id: "early", start_time: "2026-11-08T14:30:00Z" });
    const late = event({ id: "late", start_time: "2026-11-09T01:30:00Z" });
    const rows =
      buildGroupHome(
        reads({ events: [early, late], signups: [signup("Greeters", "2026-11-08", [USER])] }),
        ctx(),
      ).weekRows ?? [];
    expect(rows.map((r) => [r.title, r.serving])).toEqual([
      ["early", true],
      ["late", false],
    ]);
  });

  describe("a date you're serving when its earliest event isn't listed", () => {
    const servingToday = [signup("Greeters", TODAY, [USER])];
    const service = event({ id: "service", start_time: "2026-11-03T14:30:00Z" });
    const finished = event({
      id: "finished",
      start_time: "2026-11-03T13:00:00Z",
      end_time: "2026-11-03T13:30:00Z",
    });
    const call = event({
      id: "call",
      start_time: "2026-11-03T13:50:00Z",
      end_time: "2026-11-03T14:20:00Z",
      meeting_url: "https://zoom.us/j/1",
    });
    const rowsFor = (events: Event[]) =>
      (buildGroupHome(reads({ events, signups: servingToday }), ctx()).weekRows ?? []).map((r) => [
        r.title,
        r.serving,
      ]);

    it("tags the next event once an earlier one has ended", () => {
      expect(rowsFor([finished, service])).toEqual([["service", true]]);
    });

    it("tags the next event while an earlier one holds the join panel", () => {
      expect(rowsFor([call, service])).toEqual([["service", true]]);
    });

    it("gives the date its own row while its only event holds the join panel", () => {
      expect(rowsFor([call])).toEqual([["Greeters", true]]);
    });

    it("drops the date once all its events have ended", () => {
      expect(rowsFor([finished])).toEqual([]);
    });

    it("drops the date while its only event sits in the join panel's ended grace period", () => {
      const endedCall = { ...call, start_time: "2026-11-03T13:00:00Z", end_time: "2026-11-03T13:50:00Z" };
      const home = buildGroupHome(
        reads({ events: [endedCall], signups: servingToday, lessonCount: 1 }),
        ctx(),
      );
      expect(home.startingNow?.title).toBe("call");
      expect(home.weekRows).toEqual([]);
    });
  });

  it("gives a serving date with no event its own row, in date order", () => {
    const wed = event({ id: "wed", start_time: "2026-11-04T23:00:00Z" });
    const rows =
      buildGroupHome(
        reads({ events: [wed], signups: [signup("Greeters", "2026-11-08", [USER])] }),
        ctx(),
      ).weekRows ?? [];
    expect(rows.map((r) => [r.title, r.time, r.serving, r.weekday, r.day])).toEqual([
      ["wed", "6:00 PM", false, "Wed", "4"],
      ["Greeters", null, true, "Sun", "8"],
    ]);
    expect(rows[1].href).toBe(`/g/${GROUP}/serving/Greeters`);
  });

  it("does not list a date someone else is serving, or a serving date past the week", () => {
    const rows =
      buildGroupHome(
        reads({
          signups: [signup("Greeters", "2026-11-08"), signup("Greeters", "2026-11-15", [USER])],
        }),
        ctx(),
      ).weekRows ?? [];
    expect(rows).toEqual([]);
  });

  it("fails with the viewer's replies, not as an empty list", () => {
    const home = buildGroupHome(reads({ rsvps: null }), ctx());
    expect(home.weekRows).toBeNull();
    expect(home.nothingAtAll).toBe(false);
  });

  it("fails with the serving dates, so a server never reads as not serving", () => {
    const events = [event({ id: "e", start_time: "2026-11-05T14:00:00Z" })];
    for (const isLeader of [false, true]) {
      expect(buildGroupHome(reads({ events, signups: null }), ctx({ isLeader })).weekRows).toBeNull();
    }
  });
});

describe("celebrations", () => {
  it("writes two names, then a count of the rest", () => {
    expect(namesLine(["A"])).toBe("A");
    expect(namesLine(["A", "B"])).toBe("A and B");
    expect(namesLine(["A", "B", "C"])).toBe("A, B and 1 more");
    expect(namesLine(["A", "B", "C", "D", "E"])).toBe("A, B and 3 more");
  });

  const birthdayOn = (id: string, month: number, day: number) =>
    person({ id, birth_month: month, birth_day: day });

  it("lists this group's members in the Directory's week, nearest first", () => {
    const home = buildGroupHome(
      reads({
        members: [
          birthdayOn("later", 11, 9),
          birthdayOn("sooner", 11, 4),
          birthdayOn("outsider", 11, 5),
          birthdayOn("past-the-week", 11, 10),
        ],
        roster: ["later", "sooner", "past-the-week"].map((profile_id) => ({
          profile_id,
          joined_at: "2020-01-01T00:00:00Z",
        })),
      }),
      ctx(),
    );
    expect(home.celebrations).toEqual([
      {
        kind: "birthday",
        title: "Birthdays this week",
        names: "sooner Alvarez and later Alvarez",
        href: `/g/${GROUP}/directory/birthdays?when=week`,
      },
    ]);
  });

  it("leaves out someone whose date the view hides", () => {
    const home = buildGroupHome(
      reads({
        members: [person({ id: "hidden" })],
        roster: [{ profile_id: "hidden", joined_at: "2020-01-01T00:00:00Z" }],
      }),
      ctx(),
    );
    expect(home.celebrations).toEqual([]);
  });

  it("is singular for one anniversary and opens the Directory's week", () => {
    const family = {
      id: "f1",
      family_name: "Bell",
      anniversary_month: 11, anniversary_day: 5, anniversary_year: 2010,
      photo_url: null,
      members: [
        { id: "m", relationship: "primary", first_name: "Marcus", preferred_name: null },
        { id: "d", relationship: "spouse", first_name: "Dana", preferred_name: null },
      ],
      family_members_list: [],
    } as unknown as FamilyDirectoryFull;
    const home = buildGroupHome(
      reads({
        families: [family],
        roster: [{ profile_id: "m", joined_at: "2020-01-01T00:00:00Z" }],
      }),
      ctx(),
    );
    expect(home.celebrations).toEqual([
      {
        kind: "anniversary",
        title: "Anniversary this week",
        names: "Marcus & Dana Bell",
        href: `/g/${GROUP}/directory/anniversaries?when=week`,
      },
    ]);
  });
});

describe("the serving card", () => {
  const coverage = (teams: ServingTeamRow[], signups: ServingSignupRow[]) =>
    teamCoverage(teams, signups, USER, TODAY);

  it("counts a set block's remaining Sundays, not a rolling window", () => {
    const [greeters] = coverage([block("Greeters", "2027-05-02")], [signup("Greeters", "2026-11-08")]);
    expect(greeters.openCount).toBe(25);
    expect(greeters.nextOpen).toBe("2026-11-15");
    expect(coverage([block("Greeters", "2026-11-01")], [])).toEqual([]);
  });

  it("asks with the count and the next open date", () => {
    const [card] = servingCards(coverage([team("Greeters")], []), ["Greeters"], GROUP, TODAY);
    expect(card).toEqual({
      teamId: "Greeters",
      title: "Greeters needs people",
      detail: "4 open dates · next is Sun, Nov 8",
      signedUp: false,
      href: `/g/${GROUP}/serving/Greeters`,
    });
  });

  it("words one open date differently", () => {
    const [card] = servingCards(coverage([team("Greeters", 1)], []), ["Greeters"], GROUP, TODAY);
    expect(card.title).toBe("Greeters needs someone");
    expect(card.detail).toBe("1 open date · Sun, Nov 8");
  });

  it("counts a date a spouse put them on as signed up", () => {
    const signups = [signup("Greeters", "2026-11-15", ["spouse", USER])];
    const [card] = servingCards(coverage([team("Greeters")], signups), ["Greeters"], GROUP, TODAY);
    expect(card.signedUp).toBe(true);
    expect(card.detail).toBe("3 open dates · next is Sun, Nov 8");
  });

  it("does not count a date outside the team's window as signed up", () => {
    const signups = [signup("Greeters", "2026-12-20", [USER])];
    const [card] = servingCards(coverage([team("Greeters", 2)], signups), ["Greeters"], GROUP, TODAY);
    expect(card.signedUp).toBe(false);
  });

  it("is gone once every date is covered, and for someone on no team", () => {
    const signups = [signup("Greeters", "2026-11-08")];
    expect(servingCards(coverage([team("Greeters", 1)], signups), ["Greeters"], GROUP, TODAY)).toEqual([]);
    expect(servingCards(coverage([team("Greeters")], []), [], GROUP, TODAY)).toEqual([]);
  });

  it("shows two teams at most, soonest open date first", () => {
    const signups = [signup("A", "2026-11-08"), signup("B", "2026-11-08")];
    const cards = servingCards(
      coverage([team("A"), team("B"), team("C")], signups),
      ["A", "B", "C"],
      GROUP,
      TODAY,
    );
    expect(cards.map((c) => c.teamId)).toEqual(["C", "A"]);
  });

  it("shows a leader the To do row instead", () => {
    const home = buildGroupHome(
      reads({ servingTeams: [team("Greeters")], myTeamIds: ["Greeters"] }),
      ctx({ isLeader: true }),
    );
    expect(home.servingCards).toEqual([]);
    expect(home.todo).toEqual([
      {
        kind: "serving",
        key: "serving-Greeters",
        title: "Greeters has 4 open dates",
        detail: "Next is Sun, Nov 8",
        href: `/g/${GROUP}/serving/Greeters`,
      },
    ]);
  });
});

describe("To do", () => {
  it("lists only what is waiting, for a leader, with each row's page", () => {
    const home = buildGroupHome(
      reads({
        pendingJoinCount: 2,
        drafts: [{ id: "d", title: "Meal train" }],
      }),
      ctx({ isLeader: true }),
    );
    expect(home.todo?.map((r) => [r.title, r.detail, r.href])).toEqual([
      ["2 people asked to join", "Approve or decline", `/g/${GROUP}/settings/requests`],
      ["1 announcement to publish", "Meal train", `/g/${GROUP}/announcements`],
    ]);
  });

  it("is singular for one request, plural for several drafts", () => {
    const home = buildGroupHome(
      reads({
        pendingJoinCount: 1,
        drafts: [
          { id: "a", title: "A" },
          { id: "b", title: "B" },
        ],
      }),
      ctx({ isLeader: true }),
    );
    expect(home.todo?.map((r) => r.title)).toEqual([
      "1 person asked to join",
      "2 announcements to publish",
    ]);
  });

  it("is empty for a member whatever is waiting", () => {
    expect(buildGroupHome(reads({ pendingJoinCount: 3 }), ctx()).todo).toEqual([]);
  });

  it("tells a leader a set block needs more dates from two weeks before its last date", () => {
    const leader = ctx({ isLeader: true });
    const twoWeeksOut = block("Greeters", "2026-11-17");
    const home = buildGroupHome(reads({ servingTeams: [twoWeeksOut], signups: [] }), leader);
    expect(home.todo?.[0]).toMatchObject({
      kind: "serving",
      title: "Greeters needs more dates",
      detail: "Last date is Nov 17",
      href: `/g/${GROUP}/serving/Greeters`,
    });
    expect(needsMoreDates([block("Greeters", "2026-11-18")], TODAY)).toEqual([]);
    expect(needsMoreDates([block("Greeters", "2026-11-03")], TODAY)).toHaveLength(1);
    expect(needsMoreDates([block("Greeters", "2026-11-02")], TODAY)).toEqual([]);
  });

  it("never asks for more dates on a rolling team", () => {
    expect(needsMoreDates([team("Greeters")], TODAY)).toEqual([]);
  });

  it("gives a team lead who does not lead the group the more-dates row for their team only", () => {
    const teams = [block("Greeters", "2026-11-17"), block("Ushers", "2026-11-17")];
    const home = buildGroupHome(reads({ servingTeams: teams, myLeadTeamIds: ["Ushers"], pendingJoinCount: 3 }), ctx());
    expect(home.todo?.map((r) => r.title)).toEqual(["Ushers needs more dates"]);
    expect(buildGroupHome(reads({ servingTeams: teams, myLeadTeamIds: [] }), ctx()).todo).toEqual([]);
    expect(buildGroupHome(reads({ servingTeams: teams, myLeadTeamIds: null }), ctx()).todo).toBeNull();
  });

  it("reports a failed read instead of an empty list", () => {
    const leader = ctx({ isLeader: true });
    expect(buildGroupHome(reads({ pendingJoinCount: null }), leader).todo).toBeNull();
    expect(buildGroupHome(reads({ drafts: null }), leader).todo).toBeNull();
    expect(buildGroupHome(reads({ servingTeams: null }), leader).todo).toBeNull();
    expect(buildGroupHome(reads({ signups: null }), leader).todo).toBeNull();
  });
});

describe("New in the group", () => {
  const lesson = (over: Partial<LessonRow> & { id: string }): LessonRow => ({
    title: over.id,
    video_url: "https://example.test/v",
    lecture_date: "2026-11-01",
    scripture_reference: "James 2:14–26",
    created_at: "2026-11-01T12:00:00Z",
    ...over,
  });
  const announcement = (id: string, at: string) => ({
    id,
    title: id,
    content: "Text",
    published_at: at,
    created_at: at,
  });
  const answered = (over: Partial<AnsweredPrayerRow>): AnsweredPrayerRow =>
    ({
      id: "p",
      body: "Eli arrived safely.",
      is_anonymous: false,
      first_name: "David",
      last_name: "Reyes",
      preferred_name: null,
      answered_at: "2026-11-02T12:00:00Z",
      ...over,
    }) as AnsweredPrayerRow;
  const tiles = (over: {
    lessons?: LessonRow[];
    announcements?: ReturnType<typeof announcement>[];
    prayers?: AnsweredPrayerRow[];
    roster?: { profile_id: string; joined_at: string }[];
    members?: DirectoryProfile[];
  }) =>
    newTiles(
      over.lessons ?? [],
      over.announcements ?? [],
      over.prayers ?? [],
      over.roster ?? [],
      over.members ?? [],
      ctx(),
    );

  it("takes the newest 3 across kinds", () => {
    const result = tiles({
      lessons: [lesson({ id: "l", lecture_date: "2026-10-30" })],
      announcements: [
        announcement("new", "2026-11-03T10:00:00Z"),
        announcement("older", "2026-10-31T10:00:00Z"),
      ],
      prayers: [answered({})],
    });
    expect(result.map((t) => t.key)).toEqual(["announcement-new", "prayer-p", "announcement-older"]);
  });

  it("drops anything older than 14 days or dated ahead", () => {
    const result = tiles({
      lessons: [
        lesson({ id: "old", lecture_date: "2026-10-19" }),
        lesson({ id: "ahead", lecture_date: "2026-11-08" }),
      ],
      announcements: [announcement("old", "2026-10-20T13:59:00Z")],
      prayers: [answered({ answered_at: "2026-10-01T00:00:00Z" })],
      roster: [{ profile_id: "sam", joined_at: "2026-10-01T00:00:00Z" }],
      members: [person({ id: "sam" })],
    });
    expect(result).toEqual([]);
  });

  it("dates an undated lesson by when it was added, and writes its detail", () => {
    const [undated] = tiles({
      lessons: [lesson({ id: "u", lecture_date: null, created_at: "2026-11-02T12:00:00Z" })],
    });
    expect(undated).toMatchObject({ kind: "lesson", detail: "James 2:14–26" });
    const [dated] = tiles({ lessons: [lesson({ id: "d" })] });
    expect(dated).toMatchObject({ detail: "James 2:14–26 · Sun, Nov 1" });
  });

  it("gives a lesson tile the picture for its YouTube link, and none for any other link", () => {
    const result = tiles({
      lessons: [
        lesson({ id: "youtube", video_url: "https://youtu.be/jNQXAC9IVRw?si=x" }),
        lesson({ id: "other", video_url: "https://zoom.us/rec/1" }),
      ],
    });
    expect(result.map((t) => [t.key, t.kind === "lesson" && t.thumbnail])).toEqual([
      ["lesson-youtube", "https://img.youtube.com/vi/jNQXAC9IVRw/hqdefault.jpg"],
      ["lesson-other", null],
    ]);
  });

  it("shows an answered prayer's name, but none when anonymous", () => {
    expect(tiles({ prayers: [answered({})] })[0]).toMatchObject({ name: "David Reyes" });
    expect(tiles({ prayers: [answered({ is_anonymous: true })] })[0]).toMatchObject({ name: null });
  });

  it("puts one household's people on one tile, and leaves others apart", () => {
    const at = "2026-10-28T15:00:00Z";
    const result = tiles({
      roster: [
        { profile_id: "sam", joined_at: at },
        { profile_id: "priya", joined_at: "2026-10-28T15:05:00Z" },
        { profile_id: "solo", joined_at: at },
      ],
      members: [
        person({ id: "sam", first_name: "Sam", family_id: "f" }),
        person({ id: "priya", first_name: "Priya", family_id: "f" }),
        person({ id: "solo", first_name: "Solo", last_name: "Chen" }),
      ],
    });
    expect(result.map((t) => t.kind === "joined" && t.names)).toEqual([
      "Sam & Priya Alvarez",
      "Solo Chen",
    ]);
  });

  it("keeps household members who joined on different days apart", () => {
    const result = tiles({
      roster: [
        { profile_id: "sam", joined_at: "2026-10-28T15:00:00Z" },
        { profile_id: "priya", joined_at: "2026-10-30T15:00:00Z" },
      ],
      members: [
        person({ id: "sam", family_id: "f" }),
        person({ id: "priya", family_id: "f" }),
      ],
    });
    expect(result).toHaveLength(2);
  });

  it("leaves out the viewer and anyone the directory doesn't list", () => {
    const result = tiles({
      roster: [
        { profile_id: USER, joined_at: "2026-11-01T15:00:00Z" },
        { profile_id: "unlisted", joined_at: "2026-11-01T15:00:00Z" },
      ],
      members: [person({ id: USER })],
    });
    expect(result).toEqual([]);
  });

  it("writes full names when a household's last names differ", () => {
    expect(
      joinedNames([
        person({ id: "a", first_name: "Sam", last_name: "Alvarez" }),
        person({ id: "b", first_name: "Priya", last_name: "Chen" }),
      ]),
    ).toBe("Sam Alvarez & Priya Chen");
  });

  it("ages a tile by calendar day in the church's time zone", () => {
    // 9:00 AM Tuesday in New York; 11:30 PM Monday there is yesterday.
    expect(tileAge("2026-11-03T04:30:00Z", ZONE, NOW)).toBe("Yesterday");
    expect(tileAge("2026-11-03T13:00:00Z", ZONE, NOW)).toBe("Today");
    expect(tileAge("2026-10-31T15:00:00Z", ZONE, NOW)).toBe("3 days ago");
    expect(tileAge("2026-10-27T15:00:00Z", ZONE, NOW)).toBe("Last week");
  });

  it("reads plain text out of announcement JSON and HTML", () => {
    expect(announcementText('[{"content":[{"text":"Bring"},{"text":"a dish"}]}]')).toBe("Bring a dish");
    expect(announcementText("<p>Bring <b>a dish</b></p>")).toBe("Bring a dish");
  });
});

describe("a quiet or failed page", () => {
  it("calls an all-empty group nothing at all", () => {
    expect(buildGroupHome(reads(), ctx()).nothingAtAll).toBe(true);
  });

  it("doesn't call a group nothing at all when what it has falls outside the page's windows", () => {
    const quiet = [
      { events: [event({ id: "later", start_time: "2026-11-13T14:00:00Z" })] },
      {
        announcements: [
          {
            id: "old",
            title: "Old news",
            content: "",
            published_at: "2026-10-01T14:00:00Z",
            created_at: "2026-10-01T14:00:00Z",
          },
        ],
      },
      { hasOpenPrayer: true },
    ] satisfies Partial<GroupHomeReads>[];
    for (const over of quiet) {
      const home = buildGroupHome(reads(over), ctx());
      expect(home.nothingAtAll).toBe(false);
      expect(home.weekRows).toEqual([]);
      expect(home.newTiles).toEqual([]);
      expect(home.prayer).toBeNull();
    }
  });

  it("calls a group whose only event has passed nothing at all", () => {
    const past = event({ id: "past", start_time: "2026-11-03T12:00:00Z", end_time: "2026-11-03T13:00:00Z" });
    expect(buildGroupHome(reads({ events: [past] }), ctx()).nothingAtAll).toBe(true);
  });

  it("never calls a failed read nothing at all", () => {
    for (const failed of [
      { events: null },
      { rsvps: null },
      { members: null },
      { families: null },
      { roster: null },
      { servingTeams: null },
      { myTeamIds: null },
      { signups: null },
      { lessons: null },
      { announcements: null },
      { answeredPrayers: null },
      { openPrayers: null },
      { hasOpenPrayer: null },
    ] satisfies Partial<GroupHomeReads>[]) {
      expect(buildGroupHome(reads(failed), ctx()).nothingAtAll).toBe(false);
    }
  });

  it("picks the prayer read's one request and flags its failure", () => {
    const open = { id: "p" } as GroupHomeReads["openPrayers"] extends (infer R)[] | null ? R : never;
    expect(buildGroupHome(reads({ openPrayers: [open] }), ctx()).prayer).toBe(open);
    expect(buildGroupHome(reads({ openPrayers: null }), ctx()).prayerFailed).toBe(true);
  });

  it("flags a failed check for any request only when there is no request to show", () => {
    const open = { id: "p" } as PrayerWallRow;
    expect(buildGroupHome(reads({ hasOpenPrayer: null }), ctx()).prayerFailed).toBe(true);
    const home = buildGroupHome(reads({ hasOpenPrayer: null, openPrayers: [open] }), ctx());
    expect(home.prayerFailed).toBe(false);
    expect(home.prayer).toBe(open);
  });
});
