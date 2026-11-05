// What a one-group Home shows, built from its reads. Pure: `now` and the
// church's zone come in, so every rule here is testable without a client.

import { DateTime } from "luxon";
import { celebrationsThisWeek } from "@/components/directory/celebrations";
import { calendarDate } from "@/components/directory/utils";
import { groupPath } from "@/lib/groups/active";
import {
  daysUntil,
  formatMonthDay,
  formatServingDate,
  teamServiceDates,
  todayIn,
  type TeamDatesSettings,
} from "@/lib/serving/dates";
import { lessonThumbnail } from "@/lib/lessons";
import { ENDED_GRACE_MS, getJoinState, hasMeeting, meetingEndMs } from "@/lib/meetings";
import { displayName } from "@/lib/names";
import { prayerAuthorLabel } from "@/lib/prayer";
import { expandUpcomingEvents } from "@/lib/recurrence";
import { dayKey, formatEventTime, formatInZone, zoned } from "@/lib/time/zone";
import type {
  DirectoryProfile,
  Event,
  FamilyDirectoryFull,
  PrayerWallRow,
  Rsvp,
  RsvpStatus,
} from "@/lib/types";

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
export const NEW_WINDOW_MS = 14 * DAY_MS;
/** How far back the events read reaches, so an occurrence already under way can hold the join panel. */
export const EVENTS_LOOKBACK_MS = DAY_MS;
const MAX_NEW_TILES = 3;
const MAX_SERVING_CARDS = 2;

export type ServingTeamRow = TeamDatesSettings & { team_id: string; teams: { name: string } };
/** A set block's lead gets the To do this many days before its last date. */
export const MORE_DATES_NOTICE_DAYS = 14;
export type ServingSignupRow = {
  team_id: string;
  service_date: string;
  teams: { name: string };
  serving_signup_attendees: { profile_id: string }[];
};
export type RosterRow = { profile_id: string; joined_at: string };
export type DraftRow = { id: string; title: string };
export type LessonRow = {
  id: string;
  title: string;
  video_url: string;
  lecture_date: string | null;
  scripture_reference: string | null;
  created_at: string;
};
export type AnnouncementRow = {
  id: string;
  title: string;
  content: string;
  published_at: string | null;
  created_at: string;
};
export type AnsweredPrayerRow = PrayerWallRow & { answered_at: string };

/** Every list is null when its read failed, so a section can tell failed from empty. */
export type GroupHomeReads = {
  events: Event[] | null;
  rsvps: Rsvp[] | null;
  lessonCount: number;
  members: DirectoryProfile[] | null;
  families: FamilyDirectoryFull[] | null;
  roster: RosterRow[] | null;
  servingTeams: ServingTeamRow[] | null;
  myTeamIds: string[] | null;
  /** The teams the viewer leads, for the To do a team lead gets. */
  myLeadTeamIds: string[] | null;
  signups: ServingSignupRow[] | null;
  pendingJoinCount: number | null;
  drafts: DraftRow[] | null;
  lessons: LessonRow[] | null;
  announcements: AnnouncementRow[] | null;
  answeredPrayers: AnsweredPrayerRow[] | null;
  openPrayers: PrayerWallRow[] | null;
  /** Any open request at all, including the viewer's own and ones they're praying for. */
  hasOpenPrayer: boolean | null;
};

export type HomeContext = {
  groupId: string;
  isLeader: boolean;
  userId: string;
  timeZone: string;
  now: Date;
};

export type HomeNotice = {
  kind: "skipped" | "moved";
  key: string;
  title: string;
  detail: string | null;
  href: string;
};

export type StartingNowEvent = {
  title: string;
  href: string;
  meetingUrl: string | null;
  meetingId: string | null;
  passcode: string | null;
  startTime: string;
  endTime: string | null;
  leadMinutes: number;
};

export type TodoRow = {
  kind: "join" | "serving" | "announcement";
  key: string;
  title: string;
  detail: string;
  href: string;
};

export type ServingCard = {
  teamId: string;
  title: string;
  detail: string;
  signedUp: boolean;
  href: string;
};

export type WeekRow = {
  key: string;
  weekday: string;
  day: string;
  title: string;
  /** The time, or null on a date that has no event. */
  time: string | null;
  /** Shown only on one-time, monthly and yearly events. */
  place: string | null;
  serving: boolean;
  href: string;
  /** Set when the event asks for a reply here. */
  reply: { eventId: string; status: RsvpStatus | null } | null;
};

export type CelebrationRow = {
  kind: "birthday" | "anniversary";
  title: string;
  names: string;
  href: string;
};

export type NewTile =
  | {
      kind: "lesson";
      key: string;
      at: string;
      title: string;
      detail: string | null;
      thumbnail: string | null;
      href: string;
    }
  | { kind: "announcement"; key: string; at: string; title: string; text: string; href: string }
  | { kind: "prayer"; key: string; at: string; body: string; name: string | null; href: string }
  | { kind: "joined"; key: string; at: string; names: string; href: string };

export type GroupHome = {
  notices: HomeNotice[];
  startingNow: StartingNowEvent | null;
  /** Null when a read it needs failed. A member's list is empty. */
  todo: TodoRow[] | null;
  servingCards: ServingCard[] | null;
  weekRows: WeekRow[] | null;
  celebrations: CelebrationRow[] | null;
  newTiles: NewTile[] | null;
  prayer: PrayerWallRow | null;
  prayerFailed: boolean;
  /**
   * Every read succeeded, nothing on the page has anything to show, and the
   * group has no upcoming event, published announcement or open prayer request
   * outside the page's windows either: the empty states say so in those words.
   */
  nothingAtAll: boolean;
};

const hasEnded = (occurrence: Event, now: Date) =>
  meetingEndMs(occurrence.start_time, occurrence.end_time) <= now.getTime();

function inNextWeek(iso: string, now: Date): boolean {
  const ms = new Date(iso).getTime();
  return ms >= now.getTime() && ms < now.getTime() + WEEK_MS;
}

const monthDay = (iso: string, zone: string) =>
  formatInZone(iso, zone, { month: "short", day: "numeric" });

const shortDate = (iso: string, zone: string) =>
  formatInZone(iso, zone, { weekday: "short", month: "short", day: "numeric" });

function anchorsOf(events: Event[]): Map<string, Event> {
  return new Map(events.filter((e) => !e.series_id).map((e) => [e.id, e]));
}

function occurrenceHref(groupId: string, e: Event): string {
  const isSeriesOccurrence = !!e.recurrence_frequency && !e.series_id;
  const query = isSeriesOccurrence ? `?occurrence=${encodeURIComponent(e.start_time)}` : "";
  return groupPath(groupId, `/calendar/${e.id}${query}`);
}

/** The anchor's time of day on the exception's own date, as an instant. */
function originalStart(row: Event, anchor: Event, zone: string): DateTime {
  const seriesTime = zoned(anchor.start_time, zone);
  return zoned(row.series_occurrence_date ?? row.start_time, zone).set({
    hour: seriesTime.hour,
    minute: seriesTime.minute,
    second: seriesTime.second,
    millisecond: 0,
  });
}

/** "It's in the Fellowship Hall, not Room 204.", or null when neither time nor place differs. */
function movedDetail(row: Event, anchor: Event, zone: string): string | null {
  const start = row.start_time;
  const original = originalStart(row, anchor, zone);
  const originalIso = original.toUTC().toISO() ?? start;
  const place = row.location?.trim() || null;
  const oldPlace = anchor.location?.trim() || null;
  const timeMoved = original.toMillis() !== new Date(start).getTime();
  const placeMoved = place !== oldPlace;
  if (!timeMoved && !placeMoved) return null;

  const sameDay = dayKey(start, zone) === dayKey(originalIso, zone);
  const newWhen = !timeMoved
    ? ""
    : sameDay
      ? `at ${formatEventTime(start, zone)}`
      : `on ${shortDate(start, zone)} at ${formatEventTime(start, zone)}`;
  const oldWhen = !timeMoved
    ? ""
    : sameDay
      ? formatEventTime(originalIso, zone)
      : shortDate(originalIso, zone);
  const newWhere = placeMoved && place ? `in ${place}` : "";
  if (!timeMoved && !newWhere) return `It's no longer in ${oldPlace}.`;
  const oldWhere = !placeMoved || !oldPlace ? "" : timeMoved ? `in ${oldPlace}` : oldPlace;

  const after = [newWhen, newWhere].filter(Boolean).join(" ");
  const before = [oldWhen, oldWhere].filter(Boolean).join(" ");
  return before ? `It's ${after}, not ${before}.` : `It's ${after}.`;
}

/**
 * Deleted and moved dates of repeating events in the next 7 days, soonest
 * first. A moved date counts when either its old or its new date is in that
 * window: moving this Sunday to next month is still news this week.
 */
export function dateNotices(events: Event[], ctx: HomeContext): HomeNotice[] {
  const { groupId, timeZone: zone, now } = ctx;
  const anchors = anchorsOf(events);
  const upcoming = expandUpcomingEvents(events, zone, now);
  const dated: { at: number; notice: HomeNotice }[] = [];

  for (const row of events) {
    if (!row.series_id) continue;
    const anchor = anchors.get(row.series_id);
    const title = anchor?.title ?? row.title;

    if (row.is_cancelled) {
      if (!inNextWeek(row.start_time, now)) continue;
      const after = new Date(row.start_time).getTime();
      const next = upcoming.find(
        (o) =>
          (o.id === row.series_id || o.series_id === row.series_id) &&
          new Date(o.start_time).getTime() > after,
      );
      dated.push({
        at: after,
        notice: {
          kind: "skipped",
          key: row.id,
          title: `No ${title} on ${monthDay(row.start_time, zone)}`,
          detail: next
            ? `The next one is ${shortDate(next.start_time, zone)} at ${formatEventTime(next.start_time, zone)}.`
            : null,
          href: next ? occurrenceHref(groupId, next) : groupPath(groupId, `/calendar/${row.series_id}`),
        },
      });
      continue;
    }

    if (!anchor || !row.series_occurrence_date) continue;
    const detail = movedDetail(row, anchor, zone);
    if (!detail) continue;
    if (!inNextWeek(row.start_time, now) && !inNextWeek(row.series_occurrence_date, now)) continue;
    dated.push({
      at: new Date(row.series_occurrence_date).getTime(),
      notice: {
        kind: "moved",
        key: row.id,
        title: `${title} on ${monthDay(row.series_occurrence_date, zone)} moves`,
        detail,
        href: groupPath(groupId, `/calendar/${row.id}`),
      },
    });
  }

  return dated.sort((a, b) => a.at - b.at).map((d) => d.notice);
}

/**
 * The event for the Clay join panel: one set to show on Home, from its join
 * window opening until the ended grace period runs out. Meeting fields live on
 * the series anchor; an exception row inherits them. A live event outranks one
 * that has ended.
 */
function startingNowEvent(occurrences: Event[], anchors: Map<string, Event>, ctx: HomeContext) {
  const { now, groupId } = ctx;
  const candidates = occurrences.flatMap((occurrence) => {
    const meeting = (occurrence.series_id && anchors.get(occurrence.series_id)) || occurrence;
    return hasMeeting(meeting) && meeting.meeting_show_on_dashboard ? [{ occurrence, meeting }] : [];
  });
  const stateOf = ({ occurrence: o, meeting: m }: (typeof candidates)[number]) =>
    getJoinState(now, o.start_time, o.end_time, m.meeting_lead_minutes);
  const chosen =
    candidates.find((c) => stateOf(c) === "live") ??
    candidates.find(
      (c) =>
        stateOf(c) === "ended" &&
        meetingEndMs(c.occurrence.start_time, c.occurrence.end_time) + ENDED_GRACE_MS > now.getTime(),
    );
  if (!chosen) return null;
  const { occurrence, meeting } = chosen;
  return {
    occurrence,
    panel: {
      title: occurrence.title,
      href: occurrenceHref(groupId, occurrence),
      meetingUrl: meeting.meeting_url,
      meetingId: meeting.meeting_id,
      passcode: meeting.meeting_passcode,
      startTime: occurrence.start_time,
      endTime: occurrence.end_time,
      leadMinutes: meeting.meeting_lead_minutes,
    } satisfies StartingNowEvent,
  };
}

/** Daily and weekly events, at any interval, are the regulars: they never ask for a reply here. */
function repeatsOften(event: Event, anchors: Map<string, Event>): boolean {
  if (event.series_id && !anchors.has(event.series_id)) return true;
  const frequency = event.series_id
    ? anchors.get(event.series_id)?.recurrence_frequency
    : event.recurrence_frequency;
  return frequency === "daily" || frequency === "weekly";
}

/**
 * This week's rows in date order. serving_signups has no link to events, so a
 * serving date matches on the calendar date in the church's zone, on that
 * day's earliest listed event. A date with none listed gets its own row, unless
 * all of that day's events have ended.
 */
export function weekRows(
  occurrences: Event[],
  anchors: Map<string, Event>,
  rsvps: Rsvp[],
  signups: ServingSignupRow[],
  skip: Event | null,
  ctx: HomeContext,
): WeekRow[] {
  const { groupId, userId, timeZone: zone, now } = ctx;
  const today = todayIn(zone, now);
  const status = new Map(rsvps.map((r) => [r.event_id, r.status]));
  const mine = signups.filter((s) =>
    s.serving_signup_attendees.some((a) => a.profile_id === userId),
  );
  const myDates = new Set(mine.map((s) => s.service_date));

  const listed = occurrences.filter(
    (o) =>
      o !== skip && !hasEnded(o, now) && new Date(o.start_time).getTime() < now.getTime() + WEEK_MS,
  );
  const earliestListed = new Map<string, Event>();
  for (const o of listed) {
    const day = dayKey(o.start_time, zone);
    if (!earliestListed.has(day)) earliestListed.set(day, o);
  }

  const dated: { at: number; row: WeekRow }[] = listed.map((o) => {
    const quiet = repeatsOften(o, anchors);
    const day = dayKey(o.start_time, zone);
    return {
      at: new Date(o.start_time).getTime(),
      row: {
        key: `${o.id}-${o.start_time}`,
        weekday: formatInZone(o.start_time, zone, { weekday: "short" }),
        day: formatInZone(o.start_time, zone, { day: "numeric" }),
        title: o.title,
        time: formatEventTime(o.start_time, zone),
        place: quiet ? null : o.location,
        serving: myDates.has(day) && earliestListed.get(day) === o,
        href: occurrenceHref(groupId, o),
        reply:
          !quiet && o.is_rsvp_enabled
            ? { eventId: o.id, status: status.get(o.id) ?? null }
            : null,
      },
    };
  });

  for (const s of mine) {
    if (earliestListed.has(s.service_date) || daysUntil(s.service_date, today) >= 7) continue;
    const onDay = occurrences.filter((o) => dayKey(o.start_time, zone) === s.service_date);
    if (onDay.length > 0 && onDay.every((o) => hasEnded(o, now))) continue;
    const date = zoned(s.service_date, zone);
    dated.push({
      at: date.toMillis(),
      row: {
        key: `serving-${s.team_id}-${s.service_date}`,
        weekday: date.toFormat("ccc"),
        day: date.toFormat("d"),
        title: s.teams.name,
        time: null,
        place: null,
        serving: true,
        href: groupPath(groupId, `/serving/${s.team_id}`),
        reply: null,
      },
    });
  }

  return dated.sort((a, b) => a.at - b.at).map((d) => d.row);
}

type TeamCoverage = {
  teamId: string;
  name: string;
  openCount: number;
  nextOpen: string;
  mineInWindow: boolean;
};

/** Teams with signups on and an open date in their window, soonest open date first. */
export function teamCoverage(
  teams: ServingTeamRow[],
  signups: ServingSignupRow[],
  userId: string,
  today: string,
): TeamCoverage[] {
  return teams
    .flatMap((team) => {
      const window = teamServiceDates(team, today);
      const onTeam = signups.filter(
        (s) => s.team_id === team.team_id && window.includes(s.service_date),
      );
      const covered = new Set(onTeam.map((s) => s.service_date));
      const open = window.filter((date) => !covered.has(date));
      if (open.length === 0) return [];
      return [
        {
          teamId: team.team_id,
          name: team.teams.name,
          openCount: open.length,
          nextOpen: open[0],
          mineInWindow: onTeam.some((s) =>
            s.serving_signup_attendees.some((a) => a.profile_id === userId),
          ),
        },
      ];
    })
    .sort((a, b) => a.nextOpen.localeCompare(b.nextOpen) || a.name.localeCompare(b.name));
}

/** One card per team the viewer is on, two at most. It never lists the dates. */
export function servingCards(
  coverage: TeamCoverage[],
  myTeamIds: string[],
  groupId: string,
  today: string,
): ServingCard[] {
  return coverage
    .filter((team) => myTeamIds.includes(team.teamId))
    .slice(0, MAX_SERVING_CARDS)
    .map((team) => {
      const next = formatServingDate(team.nextOpen, today);
      return {
        teamId: team.teamId,
        title: team.openCount === 1 ? `${team.name} needs someone` : `${team.name} needs people`,
        detail:
          team.openCount === 1
            ? `1 open date · ${next}`
            : `${team.openCount} open dates · next is ${next}`,
        signedUp: team.mineInWindow,
        href: groupPath(groupId, `/serving/${team.teamId}`),
      };
    });
}

/** The teams on set dates whose last date is near: the lead has to set more. */
export function needsMoreDates(teams: ServingTeamRow[], today: string): ServingTeamRow[] {
  return teams.filter(
    (team) =>
      team.schedule === "set" &&
      team.date_to !== null &&
      daysUntil(team.date_to, today) >= 0 &&
      daysUntil(team.date_to, today) <= MORE_DATES_NOTICE_DAYS,
  );
}

function moreDatesRows(teams: ServingTeamRow[], groupId: string, today: string): TodoRow[] {
  return needsMoreDates(teams, today).map((team) => ({
    kind: "serving",
    key: `serving-dates-${team.team_id}`,
    title: `${team.teams.name} needs more dates`,
    detail: `Last date is ${formatMonthDay(team.date_to!, today)}`,
    href: groupPath(groupId, `/serving/${team.team_id}`),
  }));
}

function todoRows(
  pendingJoinCount: number,
  coverage: TeamCoverage[],
  servingTeams: ServingTeamRow[],
  drafts: DraftRow[],
  groupId: string,
  today: string,
): TodoRow[] {
  const rows: TodoRow[] = [];
  if (pendingJoinCount > 0) {
    rows.push({
      kind: "join",
      key: "join",
      title:
        pendingJoinCount === 1 ? "1 person asked to join" : `${pendingJoinCount} people asked to join`,
      detail: "Approve or decline",
      href: groupPath(groupId, "/settings/privacy"),
    });
  }
  rows.push(...moreDatesRows(servingTeams, groupId, today));
  for (const team of coverage) {
    rows.push({
      kind: "serving",
      key: `serving-${team.teamId}`,
      title: `${team.name} has ${team.openCount} open date${team.openCount === 1 ? "" : "s"}`,
      detail: `Next is ${formatServingDate(team.nextOpen, today)}`,
      href: groupPath(groupId, `/serving/${team.teamId}`),
    });
  }
  if (drafts.length > 0) {
    rows.push({
      kind: "announcement",
      key: "announcement",
      title: `${drafts.length} announcement${drafts.length === 1 ? "" : "s"} to publish`,
      detail: drafts[0].title,
      href: groupPath(groupId, "/announcements"),
    });
  }
  return rows;
}

/** "Grace Chen", "Grace Chen and Elena Park", "Grace Chen, Elena Park and 3 more". */
export function namesLine(names: readonly string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

function celebrationRows(
  members: DirectoryProfile[],
  families: FamilyDirectoryFull[],
  roster: RosterRow[],
  ctx: HomeContext,
): CelebrationRow[] {
  const { groupId, timeZone, now } = ctx;
  const { birthdays, anniversaries } = celebrationsThisWeek({
    members,
    families,
    groupId,
    rosters: { [groupId]: new Set(roster.map((r) => r.profile_id)) },
    today: calendarDate(todayIn(timeZone, now)),
  });
  const rows: CelebrationRow[] = [];
  if (birthdays.length > 0) {
    rows.push({
      kind: "birthday",
      title: birthdays.length === 1 ? "Birthday this week" : "Birthdays this week",
      names: namesLine(birthdays.map((b) => b.name)),
      href: groupPath(groupId, "/directory/birthdays?when=week"),
    });
  }
  if (anniversaries.length > 0) {
    rows.push({
      kind: "anniversary",
      title: anniversaries.length === 1 ? "Anniversary this week" : "Anniversaries this week",
      names: namesLine(anniversaries.map((a) => a.coupleName)),
      href: groupPath(groupId, "/directory/anniversaries?when=week"),
    });
  }
  return rows;
}

/** "Sam & Priya Alvarez", or each full name when the last names differ. */
export function joinedNames(people: readonly DirectoryProfile[]): string {
  const lastNames = new Set(people.map((p) => p.last_name?.trim() || ""));
  const [only] = lastNames;
  const parts =
    lastNames.size === 1
      ? people.map((p) => p.preferred_name?.trim() || p.first_name?.trim() || "")
      : people.map((p) => displayName(p));
  const present = parts.filter(Boolean);
  const list =
    present.length > 1
      ? `${present.slice(0, -1).join(", ")} & ${present[present.length - 1]}`
      : (present[0] ?? "");
  return lastNames.size === 1 && only ? `${list} ${only}`.trim() : list;
}

/**
 * Who joined, excluding the viewer. A roster row with no directory row is
 * someone unlisted, who stays out. People from one household who joined on the
 * same day in the church's zone share a tile.
 */
function joinedTiles(
  roster: RosterRow[],
  members: DirectoryProfile[],
  cutoff: number,
  ctx: HomeContext,
): NewTile[] {
  const { groupId, userId, timeZone: zone } = ctx;
  const byId = new Map(members.map((m) => [m.id, m]));
  const groups = new Map<string, { at: string; people: DirectoryProfile[] }>();
  for (const row of roster) {
    const person = byId.get(row.profile_id);
    if (!person || person.id === userId || new Date(row.joined_at).getTime() < cutoff) continue;
    const key = person.family_id
      ? `${person.family_id}-${dayKey(row.joined_at, zone)}`
      : person.id;
    const entry = groups.get(key);
    if (entry) {
      entry.people.push(person);
      if (row.joined_at > entry.at) entry.at = row.joined_at;
    } else {
      groups.set(key, { at: row.joined_at, people: [person] });
    }
  }
  return [...groups.entries()].map(([key, { at, people }]) => ({
    kind: "joined" as const,
    key: `joined-${key}`,
    at,
    names: joinedNames(people),
    href: groupPath(groupId, "/directory"),
  }));
}

/** Plain text from announcement content, which may be JSON blocks or HTML. */
export function announcementText(content: string): string {
  try {
    const blocks: Array<{ content?: Array<{ text?: string }> }> = JSON.parse(content);
    return blocks
      .flatMap((b) => b.content ?? [])
      .map((c) => c.text ?? "")
      .join(" ")
      .slice(0, 140);
  } catch {
    return content.replace(/<[^>]+>/g, "").slice(0, 140);
  }
}

/** A lesson is as new as its date; an undated one, as new as when it was added. */
function lessonInstant(lesson: LessonRow, zone: string): string {
  return lesson.lecture_date
    ? (zoned(lesson.lecture_date, zone).toUTC().toISO() ?? lesson.created_at)
    : lesson.created_at;
}

/** The newest 3 things from the last 14 days, across lessons, announcements, answered prayers and joins. */
export function newTiles(
  lessons: LessonRow[],
  announcements: AnnouncementRow[],
  answered: AnsweredPrayerRow[],
  roster: RosterRow[],
  members: DirectoryProfile[],
  ctx: HomeContext,
): NewTile[] {
  const { groupId, timeZone: zone, now } = ctx;
  const cutoff = now.getTime() - NEW_WINDOW_MS;
  const today = todayIn(zone, now);

  const tiles: NewTile[] = [
    ...lessons.map(
      (l): NewTile => ({
        kind: "lesson",
        key: `lesson-${l.id}`,
        at: lessonInstant(l, zone),
        title: l.title,
        detail:
          [l.scripture_reference, l.lecture_date && formatServingDate(l.lecture_date, today)]
            .filter(Boolean)
            .join(" · ") || null,
        thumbnail: lessonThumbnail(l),
        href: groupPath(groupId, `/lectures/${l.id}`),
      }),
    ),
    ...announcements.map(
      (a): NewTile => ({
        kind: "announcement",
        key: `announcement-${a.id}`,
        at: a.published_at || a.created_at,
        title: a.title,
        text: announcementText(a.content),
        href: groupPath(groupId, `/announcements#${a.id}`),
      }),
    ),
    ...answered.map(
      (p): NewTile => ({
        kind: "prayer",
        key: `prayer-${p.id}`,
        at: p.answered_at,
        body: p.body,
        name: p.is_anonymous ? null : prayerAuthorLabel(p),
        href: groupPath(groupId, "/prayer"),
      }),
    ),
    ...joinedTiles(roster, members, cutoff, ctx),
  ];

  return tiles
    .filter((tile) => new Date(tile.at).getTime() >= cutoff && new Date(tile.at) <= now)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, MAX_NEW_TILES);
}

/** "Today", "Yesterday", "3 days ago", "Last week", counted in calendar days in the church's zone. */
export function tileAge(iso: string, zone: string, now: Date): string {
  const days = daysUntil(todayIn(zone, now), dayKey(iso, zone));
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return days < 14 ? "Last week" : "2 weeks ago";
}

export function buildGroupHome(reads: GroupHomeReads, ctx: HomeContext): GroupHome {
  const { groupId, isLeader, userId, timeZone, now } = ctx;
  const today = todayIn(timeZone, now);
  const { events, rsvps, members, families, roster, signups, servingTeams } = reads;

  const coverage =
    servingTeams && signups ? teamCoverage(servingTeams, signups, userId, today) : null;

  // A leader's To do covers the group; a team lead's only the set-date teams
  // they lead that are running out of dates.
  const todo = !isLeader
    ? servingTeams && reads.myLeadTeamIds
      ? moreDatesRows(
          servingTeams.filter((team) => reads.myLeadTeamIds!.includes(team.team_id)),
          groupId,
          today,
        )
      : reads.myLeadTeamIds?.length === 0
        ? []
        : null
    : coverage && reads.pendingJoinCount !== null && reads.drafts
      ? todoRows(reads.pendingJoinCount, coverage, servingTeams!, reads.drafts, groupId, today)
      : null;

  const cards = isLeader
    ? []
    : coverage && reads.myTeamIds
      ? servingCards(coverage, reads.myTeamIds, groupId, today)
      : null;

  let notices: HomeNotice[] = [];
  let starting: ReturnType<typeof startingNowEvent> = null;
  let rows: WeekRow[] | null = null;
  let eventsAhead = false;
  if (events) {
    const anchors = anchorsOf(events);
    const occurrences = expandUpcomingEvents(
      events,
      timeZone,
      new Date(now.getTime() - EVENTS_LOOKBACK_MS),
    );
    notices = dateNotices(events, ctx);
    starting = startingNowEvent(occurrences, anchors, ctx);
    eventsAhead = occurrences.some((o) => !hasEnded(o, now));
    // Replies pick the chosen button and signups the serving tag, so the rows fail with either.
    rows =
      rsvps && signups
        ? weekRows(occurrences, anchors, rsvps, signups, starting?.occurrence ?? null, ctx)
        : null;
  }

  const celebrations =
    members && families && roster ? celebrationRows(members, families, roster, ctx) : null;

  const tiles =
    reads.lessons && reads.announcements && reads.answeredPrayers && roster && members
      ? newTiles(reads.lessons, reads.announcements, reads.answeredPrayers, roster, members, ctx)
      : null;

  const prayer = reads.openPrayers?.[0] ?? null;

  const nothingAtAll =
    notices.length === 0 &&
    !starting &&
    todo?.length === 0 &&
    cards?.length === 0 &&
    rows?.length === 0 &&
    celebrations?.length === 0 &&
    tiles?.length === 0 &&
    !eventsAhead &&
    reads.announcements?.length === 0 &&
    reads.openPrayers?.length === 0 &&
    reads.hasOpenPrayer === false;

  return {
    notices,
    startingNow: starting?.panel ?? null,
    todo,
    servingCards: cards,
    weekRows: rows,
    celebrations,
    newTiles: tiles,
    prayer,
    prayerFailed: reads.openPrayers === null || (prayer === null && reads.hasOpenPrayer === null),
    nothingAtAll,
  };
}
