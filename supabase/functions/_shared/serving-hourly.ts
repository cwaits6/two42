// The hourly serving reminder run. Each firing works out, from each church's
// clock alone, whether any of its teams could be due, reads the teams that
// are in one query, and claims the reminders still unsent through
// serving_reminder_claim() before anything is mailed. The sent record keeps
// it to one reminder per person per team per local day; a firing that fails
// or runs out of time leaves the rest to the next one, until the retry
// window closes for the day.
//
// Runs on the service key, so every chain here carries the org_id the
// listActiveOrgs() read resolved. Deliberately free of any supabase-js
// import so it can be unit tested offline against the structural types.

import { upcomingServiceDates } from "./serving-dates.ts";
import { localClock, orgCanBeDue, teamIsDue } from "./serving-due.ts";
import {
  forEachOrg,
  OrgRunError,
  summarize,
  type ItemFailure,
  type Org,
  type OrgRunCounts,
} from "./orgs.ts";

type QueryError = { message: string } | null;

/** One enabled team, with its pass for the day when it has one. */
export interface DueRow {
  team_id: string;
  reminder_days: number[];
  send_hour: number | null;
  teams: {
    name: string;
    group_id: string;
    serving_reminder_passes: Array<{
      send_date: string;
      serving_reminder_sends: Array<{ sent_at: string | null }>;
    }>;
  } | null;
}

/** One reminder serving_reminder_claim() handed this firing. */
export interface ClaimRow {
  team_id: string;
  profile_id: string;
  email: string;
  first_name: string | null;
  preferred_name: string | null;
}

interface SettingsChain extends PromiseLike<{ data: DueRow[] | null; error: QueryError }> {
  eq(column: string, value: unknown): SettingsChain;
  contains(column: string, value: unknown): SettingsChain;
}

interface SettleChain extends PromiseLike<{ error: QueryError }> {
  eq(column: string, value: unknown): SettleChain;
  in(column: string, values: readonly unknown[]): SettleChain;
}

/** The narrow slice of the Supabase client this module needs. */
export interface HourlyClient {
  from(table: "serving_team_settings"): { select(columns: string): SettingsChain };
  from(table: "serving_reminder_sends"): { update(values: Record<string, unknown>): SettleChain };
  rpc(
    fn: "serving_reminder_claim",
    args: { _org_id: string; _send_date: string; _service_date: string; _team_ids: string[] },
  ): PromiseLike<{ data: ClaimRow[] | null; error: QueryError }>;
}

export interface Recipient {
  orgId: string;
  teamId: string;
  teamName: string;
  groupId: string;
  profileId: string;
  email: string;
  firstName: string | null;
  preferredName: string | null;
  /** The local date of the send, part of the record's key. */
  sendDate: string;
  serviceDate: string;
}

/**
 * sent: Resend accepted it, or had already accepted it under the same key.
 * retry: Resend refused it or it never left; its claim is released for a
 * later firing. rate_limited: Resend asked for a pause; this and every
 * remaining claim are released and the firing stops sending.
 */
export type SendOutcome = "sent" | "retry" | "rate_limited";

export interface HourlyDeps {
  now: Date;
  /** Milliseconds since the firing started. */
  elapsed(): number;
  /** No new team is started once this much of the firing has gone. */
  budgetMs: number;
  /** Per church, the function that mails one reminder. */
  sender(org: Org): (recipient: Recipient) => Promise<SendOutcome>;
}

export interface HourlySummary extends ReturnType<typeof summarize> {
  /** Teams due at this firing with a reminder still to send. */
  due: number;
  budgetExhausted: boolean;
  rateLimited: boolean;
}

const DUE_SELECT =
  "team_id, reminder_days, send_hour, teams!inner(name, group_id, serving_reminder_passes(send_date, serving_reminder_sends(sent_at)))";

function passFinished(row: DueRow, sendDate: string): boolean {
  const pass = row.teams?.serving_reminder_passes.find((p) => p.send_date === sendDate);
  return !!pass && pass.serving_reminder_sends.every((s) => s.sent_at !== null);
}

export async function runHourly(
  supabase: HourlyClient,
  orgs: Org[],
  deps: HourlyDeps,
): Promise<HourlySummary> {
  let due = 0;
  let budgetExhausted = false;
  let rateLimited = false;
  const outOfTime = () => deps.elapsed() >= deps.budgetMs;

  const results = await forEachOrg(orgs, async (org): Promise<OrgRunCounts> => {
    const none = { sent: 0, sendFailures: 0 };
    if (budgetExhausted || rateLimited) return none;

    // Before any query: a church whose clock is outside the window costs
    // nothing, and a zone Intl rejects fails this church, not its emails.
    const clock = localClock(org.timezone, deps.now);
    if (!orgCanBeDue(clock)) return none;

    const { data: rows, error } = await supabase
      .from("serving_team_settings")
      .select(DUE_SELECT)
      .eq("org_id", org.id)
      .eq("enabled", true)
      .contains("reminder_days", [clock.weekday])
      .eq("teams.serving_reminder_passes.send_date", clock.date);
    if (error) throw new OrgRunError(`serving_team_settings query failed: ${error.message}`, none);

    const pending = (rows ?? []).filter(
      (row) => row.teams && teamIsDue(row, clock) && !passFinished(row, clock.date),
    );
    if (pending.length === 0) return none;
    due += pending.length;

    if (outOfTime()) {
      budgetExhausted = true;
      return none;
    }

    const serviceDate = upcomingServiceDates(1, clock.date)[0];
    const { data: claimed, error: claimError } = await supabase.rpc("serving_reminder_claim", {
      _org_id: org.id,
      _send_date: clock.date,
      _service_date: serviceDate,
      _team_ids: pending.map((row) => row.team_id),
    });
    if (claimError) throw new OrgRunError(`serving_reminder_claim failed: ${claimError.message}`, none);

    const teams = new Map(pending.map((row) => [row.team_id, row.teams!]));
    const send = deps.sender(org);
    const sentIds = new Map<string, string[]>();
    const releasedIds = new Map<string, string[]>();
    const record = (map: Map<string, string[]>, row: ClaimRow) =>
      map.set(row.team_id, [...(map.get(row.team_id) ?? []), row.profile_id]);

    let sent = 0;
    let sendFailures = 0;
    const queue = [...(claimed ?? [])];
    while (queue.length > 0) {
      const row = queue.shift()!;
      if (budgetExhausted || rateLimited) {
        record(releasedIds, row);
        continue;
      }
      if (outOfTime()) {
        budgetExhausted = true;
        record(releasedIds, row);
        continue;
      }
      const team = teams.get(row.team_id)!;
      const outcome = await send({
        orgId: org.id,
        teamId: row.team_id,
        teamName: team.name,
        groupId: team.group_id,
        profileId: row.profile_id,
        email: row.email,
        firstName: row.first_name,
        preferredName: row.preferred_name,
        sendDate: clock.date,
        serviceDate,
      });
      if (outcome === "sent") {
        sent++;
        record(sentIds, row);
      } else {
        if (outcome === "rate_limited") rateLimited = true;
        else sendFailures++;
        record(releasedIds, row);
      }
    }

    // A settle that fails leaves the row claimed; the next firing claims it
    // again once it is stale, and the idempotency key keeps Resend from
    // sending it twice.
    const itemFailures: ItemFailure[] = [];
    const settle = async (teamId: string, values: Record<string, unknown>, ids: string[]) => {
      const { error: settleError } = await supabase
        .from("serving_reminder_sends")
        .update(values)
        .eq("org_id", org.id)
        .eq("team_id", teamId)
        .eq("send_date", clock.date)
        .in("profile_id", ids);
      if (settleError) {
        itemFailures.push({ item: teamId, error: `serving_reminder_sends update failed: ${settleError.message}` });
      }
    };
    for (const [teamId, ids] of sentIds) await settle(teamId, { sent_at: deps.now.toISOString() }, ids);
    for (const [teamId, ids] of releasedIds) await settle(teamId, { claimed_at: null }, ids);

    return { sent, sendFailures, itemFailures };
  });

  return { ...summarize(results), due, budgetExhausted, rateLimited };
}
