// Which event dates are due a reminder at a firing. Pure, so every boundary
// is unit tested: the entry point only reads the rows and wires this in.
//
// The day runs from one 15:00 UTC to the next, and an event that chose N days
// before is due in the one cycle whose Nth 24 hours hold its start. Windows
// are counted in absolute hours from the cycle's start, not from the firing's
// own clock and not in the church's calendar days, so consecutive cycles
// leave no gap and no overlap across a clock change, and every firing inside
// one cycle sees the same window.

import { localDay, seriesDatesBetween, type SeriesRule } from "./event-dates.ts";
import { DAYS_BEFORE, REMINDER_FIRING_HOUR_UTC } from "./event-reminder-schedule.ts";

const DAY_MS = 86_400_000;

export const LONGEST_DAYS_BEFORE = Math.max(...DAYS_BEFORE);

/** The latest 15:00 UTC at or before `now`. */
export function cycleStart(now: Date): Date {
  const start = new Date(now);
  start.setUTCHours(REMINDER_FIRING_HOUR_UTC, 0, 0, 0);
  if (start.getTime() > now.getTime()) start.setUTCDate(start.getUTCDate() - 1);
  return start;
}

/**
 * The starts due in this cycle for an event that chose `daysBefore`:
 * `after < start <= upTo`. Null when the event chose no reminder.
 */
export function reminderWindow(daysBefore: number, now: Date): { after: Date; upTo: Date } | null {
  if (!(DAYS_BEFORE as readonly number[]).includes(daysBefore)) return null;
  const cycle = cycleStart(now).getTime();
  return {
    after: new Date(cycle + (daysBefore - 1) * DAY_MS),
    upTo: new Date(cycle + daysBefore * DAY_MS),
  };
}

/** The columns of an events row the job reads. */
export interface ReminderEventRow extends SeriesRule {
  id: string;
  group_id: string;
  title: string;
  location: string | null;
  series_id: string | null;
  series_occurrence_date: string | null;
  is_cancelled: boolean;
  reminder_days_before: number;
}

/** One date whose reminder goes out in this cycle. */
export interface DueDate {
  groupId: string;
  /** The event the sent record is kept under: the series for any of its dates. */
  recordEventId: string;
  /** The date's calendar day in the church's zone, the rest of the record's key. */
  occurrenceDate: string;
  /** The row of a date edited on its own, whose replies override the series'. */
  replyEventId: string | null;
  /** Path under the group, with the date for a date of a series. */
  linkPath: string;
  startIso: string;
  title: string;
  location: string | null;
}

export interface DueInput {
  /** Every row that can matter: series, single events, and dates edited or deleted on their own. */
  rows: ReminderEventRow[];
  /** Groups whose leader turned event reminders off. */
  groupsOff: Set<string>;
  zone: string;
  now: Date;
}

export function dueDates({ rows, groupsOff, zone, now }: DueInput): DueDate[] {
  const series = new Map<string, ReminderEventRow>();
  const ownDays = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!row.series_id) {
      if (row.recurrence_frequency) series.set(row.id, row);
    } else if (row.series_occurrence_date) {
      const days = ownDays.get(row.series_id) ?? new Set<string>();
      days.add(localDay(row.series_occurrence_date, zone));
      ownDays.set(row.series_id, days);
    }
  }

  const inWindow = (startIso: string, daysBefore: number): boolean => {
    const window = reminderWindow(daysBefore, now);
    if (!window) return false;
    const ts = new Date(startIso).getTime();
    return ts > window.after.getTime() && ts <= window.upTo.getTime() && ts > now.getTime();
  };

  const due: DueDate[] = [];
  for (const row of rows) {
    if (groupsOff.has(row.group_id)) continue;

    if (row.series_id) {
      // A date edited on its own keeps its series' choice; a deleted one
      // only takes its day out of the series.
      const parent = series.get(row.series_id);
      if (row.is_cancelled || !parent || !row.series_occurrence_date) continue;
      if (!inWindow(row.start_time, parent.reminder_days_before)) continue;
      due.push({
        groupId: row.group_id,
        recordEventId: row.series_id,
        occurrenceDate: localDay(row.series_occurrence_date, zone),
        replyEventId: row.id,
        linkPath: `/calendar/${row.id}`,
        startIso: new Date(row.start_time).toISOString(),
        title: row.title,
        location: row.location,
      });
      continue;
    }

    if (!row.recurrence_frequency) {
      if (!inWindow(row.start_time, row.reminder_days_before)) continue;
      due.push({
        groupId: row.group_id,
        recordEventId: row.id,
        occurrenceDate: localDay(row.start_time, zone),
        replyEventId: null,
        linkPath: `/calendar/${row.id}`,
        startIso: new Date(row.start_time).toISOString(),
        title: row.title,
        location: row.location,
      });
      continue;
    }

    const window = reminderWindow(row.reminder_days_before, now);
    if (!window) continue;
    for (const startIso of seriesDatesBetween(row, zone, window.after, window.upTo, ownDays.get(row.id))) {
      if (new Date(startIso).getTime() <= now.getTime()) continue;
      due.push({
        groupId: row.group_id,
        recordEventId: row.id,
        occurrenceDate: localDay(startIso, zone),
        replyEventId: null,
        linkPath: `/calendar/${row.id}?occurrence=${encodeURIComponent(startIso)}`,
        startIso,
        title: row.title,
        location: row.location,
      });
    }
  }
  return due;
}
