// The event reminder run. Each firing reads a church's events, works out
// which dates are due in this cycle (see event-reminder-due.ts), and claims
// each date's reminders through event_reminder_claim() before anything is
// mailed. The sent record keeps it to one reminder per person per date; a
// firing that fails or runs out of time leaves the rest to the next firing
// of the cycle.
//
// Runs on the service key, so every chain here carries the org_id the
// listActiveOrgs() read resolved. Deliberately free of any supabase-js
// import so it can be unit tested offline against the structural types.

import { chunk } from "./chunk.ts";
import {
  cycleStart,
  type DueDate,
  dueDates,
  LONGEST_DAYS_BEFORE,
  type ReminderEventRow,
} from "./event-reminder-due.ts";
import { reserveEmailQuota } from "./quota.ts";
import {
  forEachOrg,
  type ItemFailure,
  type Org,
  type OrgRunCounts,
  summarize,
} from "./orgs.ts";
import type { SendOutcome } from "./serving-hourly.ts";

type QueryError = { message: string } | null;

/**
 * The mode a job body names. A body with no mode is the job as it was
 * scheduled before the sent record; null is a body that names neither, which
 * must not run: the mode without the record mails again at every firing.
 */
export function reminderMode(rawBody: string): "dates" | "before-dates" | null {
  if (!rawBody.trim()) return "before-dates";
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const mode = (body as { mode?: unknown }).mode;
  if (mode === undefined) return "before-dates";
  return mode === "dates" ? "dates" : null;
}

/** One reminder event_reminder_claim() handed this firing. */
export interface EventClaimRow {
  profile_id: string;
  email: string;
  first_name: string | null;
  preferred_name: string | null;
}

interface EventsChain extends PromiseLike<{ data: ReminderEventRow[] | null; error: QueryError }> {
  eq(column: string, value: unknown): EventsChain;
  is(column: string, value: null): EventsChain;
  not(column: string, operator: string, value: unknown): EventsChain;
  gt(column: string, value: string): EventsChain;
  gte(column: string, value: string): EventsChain;
  lte(column: string, value: string): EventsChain;
  in(column: string, values: readonly string[]): EventsChain;
  order(column: string): EventsChain;
  range(from: number, to: number): EventsChain;
}

interface SettingsChain extends PromiseLike<{ data: Array<{ group_id: string }> | null; error: QueryError }> {
  eq(column: string, value: unknown): SettingsChain;
}

interface SettleChain extends PromiseLike<{ error: QueryError }> {
  eq(column: string, value: unknown): SettleChain;
  in(column: string, values: readonly unknown[]): SettleChain;
}

/** The narrow slice of the Supabase client this module needs. */
export interface EventRemindersClient {
  from(table: "events"): { select(columns: string): EventsChain };
  from(table: "group_settings"): { select(columns: string): SettingsChain };
  from(table: "event_reminder_sends"): { update(values: Record<string, unknown>): SettleChain };
  rpc(
    fn: "event_reminder_claim",
    args: { _org_id: string; _event_id: string; _occurrence_date: string; _reply_event_id: string | null },
  ): PromiseLike<{ data: EventClaimRow[] | null; error: QueryError }>;
  rpc(
    fn: "email_quota_consume",
    args: { _org_id: string; _n: number },
  ): PromiseLike<{ data: boolean | null; error: QueryError }>;
}

export interface EventReminder {
  orgId: string;
  date: DueDate;
  profileId: string;
  email: string;
  firstName: string | null;
  preferredName: string | null;
}

export interface EventRemindersDeps {
  now: Date;
  /** Milliseconds since the firing started. */
  elapsed(): number;
  /** No new date or send is started once this much of the firing has gone. */
  budgetMs: number;
  /** Per church, the function that mails one reminder. */
  sender(org: Org): (reminder: EventReminder) => Promise<SendOutcome>;
}

export interface EventRemindersSummary extends ReturnType<typeof summarize> {
  /** Event dates due in this cycle, whether or not anything was left to send. */
  due: number;
  budgetExhausted: boolean;
  rateLimited: boolean;
  /** Reminders the church's daily email cap refused. */
  capped: number;
}

const EVENT_SELECT =
  "id, group_id, title, location, start_time, recurrence_frequency, recurrence_interval, recurrence_end_mode, recurrence_count, recurrence_until, series_id, series_occurrence_date, is_cancelled, reminder_days_before";

// The database API returns at most this many rows a request.
const PAGE = 1000;
const SETTLE_CHUNK = 100;
const SERIES_CHUNK = 100;
const DAY_MS = 86_400_000;

async function readEvents(
  supabase: EventRemindersClient,
  orgId: string,
  what: string,
  filter: (chain: EventsChain) => EventsChain,
): Promise<ReminderEventRow[]> {
  const rows: ReminderEventRow[] = [];
  for (let from = 0;; from += PAGE) {
    const { data, error } = await filter(
      supabase.from("events").select(EVENT_SELECT).eq("org_id", orgId),
    ).order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(`events query (${what}) failed: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < PAGE) return rows;
  }
}

/** Every row that can decide a date due in this cycle, each once. */
async function readRows(supabase: EventRemindersClient, orgId: string, now: Date): Promise<ReminderEventRow[]> {
  const cycle = cycleStart(now).getTime();
  const horizon = new Date(cycle + LONGEST_DAYS_BEFORE * DAY_MS).toISOString();
  const series = await readEvents(supabase, orgId, "series", (chain) =>
    chain.not("recurrence_frequency", "is", null).is("series_id", null).lte("start_time", horizon));
  // Single events, and dates edited on their own that start inside the horizon.
  const upcoming = await readEvents(supabase, orgId, "upcoming", (chain) =>
    chain.is("recurrence_frequency", null).gt("start_time", now.toISOString()).lte("start_time", horizon));
  // Dates edited or deleted on their own, by the day they stand in for: a
  // day either side, because the day is read in the church's zone.
  const ownDates = await readEvents(supabase, orgId, "edited dates", (chain) =>
    chain
      .not("series_id", "is", null)
      .gte("series_occurrence_date", new Date(cycle - DAY_MS).toISOString())
      .lte("series_occurrence_date", new Date(cycle + (LONGEST_DAYS_BEFORE + 1) * DAY_MS).toISOString()));
  const rows = new Map([...series, ...upcoming, ...ownDates].map((row) => [row.id, row]));
  // A date moved earlier than its series' first date is inside the horizon
  // while the series row, which holds its choice, starts past it.
  const unreadSeries = new Set<string>();
  for (const row of rows.values()) {
    if (row.series_id && !rows.has(row.series_id)) unreadSeries.add(row.series_id);
  }
  for (const ids of chunk([...unreadSeries], SERIES_CHUNK)) {
    const found = await readEvents(supabase, orgId, "series of edited dates", (chain) => chain.in("id", ids));
    for (const row of found) rows.set(row.id, row);
  }
  return [...rows.values()];
}

export async function runEventReminders(
  supabase: EventRemindersClient,
  orgs: Org[],
  deps: EventRemindersDeps,
): Promise<EventRemindersSummary> {
  let due = 0;
  let budgetExhausted = false;
  let rateLimited = false;
  let capped = 0;
  const outOfTime = () => deps.elapsed() >= deps.budgetMs;

  const results = await forEachOrg(orgs, async (org): Promise<OrgRunCounts> => {
    const none = { sent: 0, sendFailures: 0 };
    if (budgetExhausted || rateLimited) return none;

    const rows = await readRows(supabase, org.id, deps.now);
    const { data: off, error } = await supabase
      .from("group_settings")
      .select("group_id")
      .eq("org_id", org.id)
      .eq("event_reminders_enabled", false);
    if (error) throw new Error(`group_settings query failed: ${error.message}`);
    const dates = dueDates({
      rows,
      groupsOff: new Set((off ?? []).map((row) => row.group_id)),
      zone: org.timezone,
      now: deps.now,
    });
    due += dates.length;

    let sent = 0;
    let sendFailures = 0;
    const itemFailures: ItemFailure[] = [];
    // The cap counts attempts, so each reminder reserves its own place just
    // before it is mailed. Once it refuses, the later dates are still
    // claimed and released: that fixes who they go to and counts what the
    // cap cost.
    let capReached = false;
    const send = deps.sender(org);

    for (const date of dates) {
      if (budgetExhausted || rateLimited) break;
      if (outOfTime()) {
        budgetExhausted = true;
        break;
      }

      const { data: claimed, error: claimError } = await supabase.rpc("event_reminder_claim", {
        _org_id: org.id,
        _event_id: date.recordEventId,
        _occurrence_date: date.occurrenceDate,
        _reply_event_id: date.replyEventId,
      });
      if (claimError) {
        itemFailures.push({ item: date.recordEventId, error: `event_reminder_claim failed: ${claimError.message}` });
        continue;
      }

      const queue = claimed ?? [];
      const sentIds: string[] = [];
      const releasedIds: string[] = [];
      let sendFailed = false;
      for (const [index, row] of queue.entries()) {
        if (!rateLimited && outOfTime()) budgetExhausted = true;
        if (budgetExhausted || rateLimited) {
          releasedIds.push(row.profile_id);
          continue;
        }
        if (capReached || !(await reserveEmailQuota(supabase, org.id, 1))) {
          if (!capReached) {
            capReached = true;
            console.warn("[org %s] daily email cap reached, event reminders past it are not sent", org.id);
          }
          capped += queue.length - index;
          releasedIds.push(...queue.slice(index).map((rest) => rest.profile_id));
          break;
        }
        let outcome: SendOutcome;
        try {
          outcome = await send({
            orgId: org.id,
            date,
            profileId: row.profile_id,
            email: row.email,
            firstName: row.first_name,
            preferredName: row.preferred_name,
          });
        } catch (err) {
          // A sender that throws fails this one reminder: it is released,
          // the event is recorded once, and the rest go on.
          outcome = "retry";
          if (!sendFailed) {
            sendFailed = true;
            itemFailures.push({
              item: date.recordEventId,
              error: `send failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }
        }
        if (outcome === "sent") {
          sent++;
          sentIds.push(row.profile_id);
        } else {
          if (outcome === "rate_limited") rateLimited = true;
          else sendFailures++;
          releasedIds.push(row.profile_id);
        }
      }

      // A settle that fails leaves the row claimed; a later firing claims it
      // again once it is stale, and the idempotency key keeps Resend from
      // sending it twice.
      const settle = async (values: Record<string, unknown>, ids: string[]) => {
        for (const part of chunk(ids, SETTLE_CHUNK)) {
          const { error: settleError } = await supabase
            .from("event_reminder_sends")
            .update(values)
            .eq("org_id", org.id)
            .eq("event_id", date.recordEventId)
            .eq("occurrence_date", date.occurrenceDate)
            .in("profile_id", part);
          if (settleError) {
            itemFailures.push({
              item: date.recordEventId,
              error: `event_reminder_sends update failed: ${settleError.message}`,
            });
          }
        }
      };
      await settle({ sent_at: deps.now.toISOString() }, sentIds);
      await settle({ claimed_at: null }, releasedIds);
    }

    return { sent, sendFailures, itemFailures };
  });

  return { ...summarize(results), due, budgetExhausted, rateLimited, capped };
}
