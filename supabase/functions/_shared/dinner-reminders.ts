// The dinner club reminder run. Each firing reads a church's dinners in
// groups with the dinner club on, works out which are due (see
// dinner-reminder-due.ts), and claims each dinner's reminders through
// dinner_reminder_claim() before anything is mailed. The sent record keeps it
// to one reminder per person per dinner date.
//
// The email carries the host's address, so its recipients come only from the
// claim, which reads the seats at that dinner's table in that church, and
// every other read here is a chain on the org_id the listActiveOrgs() read
// resolved. Free of any supabase-js import so it can be unit tested offline.

import { chunk } from "./chunk.ts";
import { type DueDinner, dinnerReadWindow, dueDinners, type ReminderDinnerRow } from "./dinner-reminder-due.ts";
import { greetingName } from "./email-html.ts";
import { reserveEmailQuota } from "./quota.ts";
import { forEachOrg, type ItemFailure, type Org, type OrgRunCounts, summarize } from "./orgs.ts";
import type { SendOutcome } from "./serving-hourly.ts";
import { logError, logWarn } from "./log.ts";

type QueryError = { message: string } | null;
type Result<T> = PromiseLike<{ data: T[] | null; error: QueryError }>;

interface Chain<T> extends Result<T> {
  eq(column: string, value: unknown): Chain<T>;
  in(column: string, values: readonly string[]): Chain<T>;
  is(column: string, value: null): Chain<T>;
  gte(column: string, value: string): Chain<T>;
  lt(column: string, value: string): Chain<T>;
}

interface SettleChain extends PromiseLike<{ error: QueryError }> {
  eq(column: string, value: unknown): SettleChain;
  in(column: string, values: readonly unknown[]): SettleChain;
}

export interface DinnerClaimRow {
  profile_id: string;
  email: string;
  first_name: string | null;
  preferred_name: string | null;
}

interface AddressRow {
  address_line1: string;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
}

/** The narrow slice of the Supabase client this module needs. */
export interface DinnerRemindersClient {
  from(table: "group_settings"): { select(columns: string): Chain<{ group_id: string }> };
  from(table: "dinner_seasons"): { select(columns: string): Chain<{ id: string; title: string }> };
  from(table: "dinners"): { select(columns: string): Chain<ReminderDinnerRow> };
  from(table: "dinner_seats"): { select(columns: string): Chain<{ party_id: string }> };
  from(table: "dinner_party_members"): { select(columns: string): Chain<{ party_id: string; profile_id: string }> };
  from(table: "profiles"): {
    select(columns: string): Chain<{ id: string; first_name: string | null; preferred_name: string | null }>;
  };
  from(table: "dinner_replies"): { select(columns: string): Chain<{ profile_id: string }> };
  from(table: "dinner_party_addresses"): { select(columns: string): Chain<AddressRow> };
  from(table: "dinner_reminder_sends"): { update(values: Record<string, unknown>): SettleChain };
  rpc(
    fn: "dinner_reminder_claim",
    args: { _org_id: string; _dinner_id: string; _dinner_date: string },
  ): PromiseLike<{ data: DinnerClaimRow[] | null; error: QueryError }>;
  rpc(fn: "email_quota_consume", args: { _org_id: string; _n: number }): PromiseLike<{
    data: boolean | null;
    error: QueryError;
  }>;
}

/** What one reminder email says. */
export interface DinnerDetails {
  seasonTitle: string;
  hostNames: string | null;
  address: string | null;
  /** First names of the people at the table who have not said Not going. */
  coming: string[];
}

export interface DinnerReminder {
  orgId: string;
  dinner: DueDinner;
  details: DinnerDetails;
  profileId: string;
  email: string;
  firstName: string | null;
  preferredName: string | null;
}

export interface DinnerRemindersDeps {
  now: Date;
  /** Milliseconds since the firing started. */
  elapsed(): number;
  /** No new dinner or send is started once this much of the firing has gone. */
  budgetMs: number;
  sender(org: Org): (reminder: DinnerReminder) => Promise<SendOutcome>;
}

export interface DinnerRemindersSummary extends ReturnType<typeof summarize> {
  due: number;
  budgetExhausted: boolean;
  rateLimited: boolean;
  capped: number;
}

const SETTLE_CHUNK = 100;

function names(list: string[]): string | null {
  if (list.length === 0) return null;
  return list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}` : list[0];
}

function addressLine(a: AddressRow): string {
  const cityLine = [a.city, [a.state, a.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [a.address_line1, a.address_line2, cityLine].filter((part) => part && part.trim()).join(", ");
}

function failed(what: string, error: { message: string }, orgId: string): never {
  logError("dinner reminder query failed", error, { step: what, ids: { org: orgId } });
  throw new Error(`${what} query failed: ${error.message}`);
}

/** The dinners in this church that could be due: running seasons, groups with the dinner club on. */
export async function readDinners(
  supabase: DinnerRemindersClient,
  orgId: string,
  now: Date,
): Promise<{ rows: ReminderDinnerRow[]; titles: Map<string, string> }> {
  const none = { rows: [], titles: new Map<string, string>() };
  const { data: on, error: onError } = await supabase
    .from("group_settings")
    .select("group_id")
    .eq("org_id", orgId)
    .eq("dinner_club_enabled", true);
  if (onError) failed("group_settings", onError, orgId);
  const groupIds = (on ?? []).map((row) => row.group_id);
  if (groupIds.length === 0) return none;

  const { data: seasons, error: seasonsError } = await supabase
    .from("dinner_seasons")
    .select("id, title")
    .eq("org_id", orgId)
    .eq("status", "published")
    .in("group_id", groupIds);
  if (seasonsError) failed("dinner_seasons", seasonsError, orgId);
  const titles = new Map((seasons ?? []).map((s) => [s.id, s.title]));
  if (titles.size === 0) return none;

  const window = dinnerReadWindow(now);
  const { data: dinners, error: dinnersError } = await supabase
    .from("dinners")
    .select("id, group_id, season_id, table_id, starts_at, host_party_id")
    .eq("org_id", orgId)
    .in("season_id", [...titles.keys()])
    .gte("starts_at", window.from)
    .lt("starts_at", window.to);
  if (dinnersError) failed("dinners", dinnersError, orgId);
  return { rows: dinners ?? [], titles };
}

/** Who is at the dinner's table, who hosts it and where. */
async function readDetails(
  supabase: DinnerRemindersClient,
  orgId: string,
  dinner: DueDinner,
  seasonTitle: string,
): Promise<DinnerDetails> {
  const { data: seats, error: seatsError } = await supabase
    .from("dinner_seats")
    .select("party_id")
    .eq("org_id", orgId)
    .eq("table_id", dinner.tableId)
    .is("left_at", null);
  if (seatsError) failed("dinner_seats", seatsError, orgId);
  const partyIds = (seats ?? []).map((s) => s.party_id);

  const { data: members, error: membersError } = partyIds.length
    ? await supabase
      .from("dinner_party_members")
      .select("party_id, profile_id")
      .eq("org_id", orgId)
      .in("party_id", partyIds)
    : { data: [], error: null };
  if (membersError) failed("dinner_party_members", membersError, orgId);
  const profileIds = (members ?? []).map((m) => m.profile_id);

  const { data: people, error: peopleError } = profileIds.length
    ? await supabase
      .from("profiles")
      .select("id, first_name, preferred_name")
      .eq("org_id", orgId)
      .in("id", profileIds)
    : { data: [], error: null };
  if (peopleError) failed("profiles", peopleError, orgId);
  const nameOf = new Map((people ?? []).map((p) => [p.id, greetingName(p.preferred_name, p.first_name) ?? ""]));

  const { data: notGoing, error: repliesError } = await supabase
    .from("dinner_replies")
    .select("profile_id")
    .eq("org_id", orgId)
    .eq("dinner_id", dinner.dinnerId)
    .eq("status", "not_going");
  if (repliesError) failed("dinner_replies", repliesError, orgId);
  const away = new Set((notGoing ?? []).map((r) => r.profile_id));

  let address: string | null = null;
  if (dinner.hostPartyId) {
    const { data: rows, error: addressError } = await supabase
      .from("dinner_party_addresses")
      .select("address_line1, address_line2, city, state, postal_code")
      .eq("org_id", orgId)
      .eq("party_id", dinner.hostPartyId);
    if (addressError) failed("dinner_party_addresses", addressError, orgId);
    address = rows?.[0] ? addressLine(rows[0]) : null;
  }

  const ordered = members ?? [];
  return {
    seasonTitle,
    hostNames: names(
      ordered.filter((m) => m.party_id === dinner.hostPartyId).map((m) => nameOf.get(m.profile_id) ?? "").filter(Boolean),
    ),
    address,
    coming: ordered
      .filter((m) => !away.has(m.profile_id))
      .map((m) => nameOf.get(m.profile_id) ?? "")
      .filter(Boolean),
  };
}

export async function runDinnerReminders(
  supabase: DinnerRemindersClient,
  orgs: Org[],
  deps: DinnerRemindersDeps,
): Promise<DinnerRemindersSummary> {
  let due = 0;
  let budgetExhausted = false;
  let rateLimited = false;
  let capped = 0;
  const outOfTime = () => deps.elapsed() >= deps.budgetMs;

  const results = await forEachOrg(orgs, async (org): Promise<OrgRunCounts> => {
    if (budgetExhausted || rateLimited) return { sent: 0, sendFailures: 0 };

    const { rows, titles } = await readDinners(supabase, org.id, deps.now);
    const dinners = dueDinners(rows, org.timezone, deps.now);
    due += dinners.length;

    let sent = 0;
    let sendFailures = 0;
    const itemFailures: ItemFailure[] = [];
    let capReached = false;
    const send = deps.sender(org);

    for (const dinner of dinners) {
      if (budgetExhausted || rateLimited) break;
      if (outOfTime()) {
        budgetExhausted = true;
        break;
      }

      const { data: claimed, error: claimError } = await supabase.rpc("dinner_reminder_claim", {
        _org_id: org.id,
        _dinner_id: dinner.dinnerId,
        _dinner_date: dinner.dinnerDate,
      });
      if (claimError) {
        itemFailures.push({ item: dinner.dinnerId, error: `dinner_reminder_claim failed: ${claimError.message}` });
        continue;
      }
      const queue = claimed ?? [];
      if (queue.length === 0) continue;

      const sentIds: string[] = [];
      const releasedIds: string[] = [];
      let details: DinnerDetails | null = null;
      try {
        details = await readDetails(supabase, org.id, dinner, titles.get(dinner.seasonId) ?? "");
      } catch (err) {
        itemFailures.push({ item: dinner.dinnerId, error: err instanceof Error ? err.message : String(err) });
        releasedIds.push(...queue.map((row) => row.profile_id));
      }

      let sendFailed = false;
      for (const [index, row] of details ? queue.entries() : []) {
        if (!rateLimited && outOfTime()) budgetExhausted = true;
        if (budgetExhausted || rateLimited) {
          releasedIds.push(row.profile_id);
          continue;
        }
        if (capReached || !(await reserveEmailQuota(supabase, org.id, 1))) {
          if (!capReached) {
            capReached = true;
            logWarn("daily email cap reached, dinner reminders past it are not sent", undefined, {
              ids: { org: org.id },
            });
          }
          capped += queue.length - index;
          releasedIds.push(...queue.slice(index).map((rest) => rest.profile_id));
          break;
        }
        let outcome: SendOutcome;
        try {
          outcome = await send({
            orgId: org.id,
            dinner,
            details: details!,
            profileId: row.profile_id,
            email: row.email,
            firstName: row.first_name,
            preferredName: row.preferred_name,
          });
        } catch (err) {
          outcome = "retry";
          if (!sendFailed) {
            sendFailed = true;
            itemFailures.push({
              item: dinner.dinnerId,
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
            .from("dinner_reminder_sends")
            .update(values)
            .eq("org_id", org.id)
            .eq("dinner_id", dinner.dinnerId)
            .eq("dinner_date", dinner.dinnerDate)
            .in("profile_id", part);
          if (settleError) {
            itemFailures.push({ item: dinner.dinnerId, error: `dinner_reminder_sends update failed: ${settleError.message}` });
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
