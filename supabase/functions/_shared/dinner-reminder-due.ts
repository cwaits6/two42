// Which dinners are due their day-before reminder at a firing. Pure, so each
// boundary is unit tested: the run only reads the rows and wires this in.
//
// A firing's cycle starts at the latest 15:00 UTC (see event-reminder-due.ts),
// and a dinner is due when its date in the church's zone is the day after
// the cycle's own date there. Every firing of one cycle sees the same dinners,
// and a moved dinner is due on its new date: the pass is keyed by it.

import { localDay } from "./event-dates.ts";
import { cycleStart } from "./event-reminder-due.ts";

const DAY_MS = 86_400_000;

/** The columns of a dinners row the job reads. */
export interface ReminderDinnerRow {
  id: string;
  group_id: string;
  season_id: string;
  table_id: string;
  starts_at: string;
  host_party_id: string | null;
}

export interface DueDinner {
  dinnerId: string;
  groupId: string;
  seasonId: string;
  tableId: string;
  hostPartyId: string | null;
  startIso: string;
  /** The dinner's date in the church's zone: the rest of the sent record's key. */
  dinnerDate: string;
}

/** The UTC span that holds every dinner due in this cycle, in any zone. */
export function dinnerReadWindow(now: Date): { from: string; to: string } {
  const start = cycleStart(now).getTime();
  return { from: new Date(start).toISOString(), to: new Date(start + 3 * DAY_MS).toISOString() };
}

/** The church-zone date this cycle reminds dinners on. */
export function dueDinnerDate(now: Date, zone: string): string {
  const today = localDay(cycleStart(now).toISOString(), zone);
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function dueDinners(rows: ReminderDinnerRow[], zone: string, now: Date): DueDinner[] {
  const date = dueDinnerDate(now, zone);
  return rows
    .filter((row) => new Date(row.starts_at).getTime() > now.getTime() && localDay(row.starts_at, zone) === date)
    .map((row) => ({
      dinnerId: row.id,
      groupId: row.group_id,
      seasonId: row.season_id,
      tableId: row.table_id,
      hostPartyId: row.host_party_id,
      startIso: row.starts_at,
      dinnerDate: date,
    }));
}
