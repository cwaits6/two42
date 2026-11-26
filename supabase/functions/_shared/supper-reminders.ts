// The Supper club reminder run. Each firing reads a church's suppers in
// groups with the Supper club on, works out which are due (see
// supper-reminder-due.ts), and claims each supper's reminders through
// supper_reminder_claim() before anything is mailed. The sent record keeps it
// to one reminder per person per supper date.
//
// The email carries the host's address, so its recipients come only from the
// claim, which reads the seats at that supper's table in that church, and
// every other read here is a chain on the org_id the listActiveOrgs() read
// resolved. Free of any supabase-js import so it can be unit tested offline.

import { chunk } from "./chunk.ts";
import { formatAddress, partyName } from "./supper-labels.ts";
import { type DueSupper, supperReadWindow, dueSuppers, type ReminderSupperRow } from "./supper-reminder-due.ts";
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
  order(column: string): Chain<T>;
  range(from: number, to: number): Chain<T>;
}

/** PostgREST truncates a response at max_rows without an error. */
const PAGE = 1000;

interface SettleChain extends PromiseLike<{ error: QueryError }> {
  eq(column: string, value: unknown): SettleChain;
  in(column: string, values: readonly unknown[]): SettleChain;
}

export interface SupperClaimRow {
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
export interface SupperRemindersClient {
  from(table: "group_settings"): { select(columns: string): Chain<{ group_id: string }> };
  from(table: "supper_rotations"): {
    select(columns: string): Chain<{ id: string; title: string; bring_list_enabled: boolean }>;
  };
  from(table: "suppers"): { select(columns: string): Chain<ReminderSupperRow> };
  from(table: "supper_seats"): { select(columns: string): Chain<{ party_id: string }> };
  from(table: "supper_party_members"): { select(columns: string): Chain<{ party_id: string; profile_id: string }> };
  from(table: "profiles"): {
    select(columns: string): Chain<{ id: string; first_name: string | null; preferred_name: string | null }>;
  };
  from(table: "supper_replies"): { select(columns: string): Chain<{ profile_id: string }> };
  from(table: "supper_party_addresses"): { select(columns: string): Chain<AddressRow> };
  from(table: "supper_contributions"): { select(columns: string): Chain<{ party_id: string; item: string }> };
  from(table: "supper_reminder_sends"): { update(values: Record<string, unknown>): SettleChain };
  rpc(
    fn: "supper_reminder_claim",
    args: { _org_id: string; _supper_id: string; _supper_date: string; _starts_at: string; _host_party_id: string | null },
  ): PromiseLike<{ data: SupperClaimRow[] | null; error: QueryError }>;
  rpc(fn: "email_quota_consume", args: { _org_id: string; _n: number }): PromiseLike<{
    data: boolean | null;
    error: QueryError;
  }>;
}

/** What one reminder email says. */
export interface SupperDetails {
  rotationTitle: string;
  hostNames: string | null;
  address: string | null;
  /** First names of the people at the table who have not said Not going. */
  coming: string[];
}

export interface SupperReminder {
  orgId: string;
  supper: DueSupper;
  details: SupperDetails;
  profileId: string;
  email: string;
  firstName: string | null;
  preferredName: string | null;
  /** What the person's party brings, when the host has said. */
  bringing: string | null;
}

interface RotationInfo {
  title: string;
  bringList: boolean;
}

export interface SupperRemindersDeps {
  now: Date;
  /** Milliseconds since the firing started. */
  elapsed(): number;
  /** No new supper or send is started once this much of the firing has gone. */
  budgetMs: number;
  sender(org: Org): (reminder: SupperReminder) => Promise<SendOutcome>;
}

export interface SupperRemindersSummary extends ReturnType<typeof summarize> {
  due: number;
  budgetExhausted: boolean;
  rateLimited: boolean;
  capped: number;
}

const SETTLE_CHUNK = 100;

function failed(what: string, error: { message: string }, orgId: string): never {
  logError("supper reminder query failed", error, { step: what, ids: { org: orgId } });
  throw new Error(`${what} query failed: ${error.message}`);
}

/** The suppers in this church that could be due: running rotations, groups with the Supper club on. */
export async function readSuppers(
  supabase: SupperRemindersClient,
  orgId: string,
  now: Date,
): Promise<{ rows: ReminderSupperRow[]; rotations: Map<string, RotationInfo> }> {
  const none = { rows: [], rotations: new Map<string, RotationInfo>() };
  const { data: on, error: onError } = await supabase
    .from("group_settings")
    .select("group_id")
    .eq("org_id", orgId)
    .eq("supper_club_enabled", true);
  if (onError) failed("group_settings", onError, orgId);
  const groupIds = (on ?? []).map((row) => row.group_id);
  if (groupIds.length === 0) return none;

  const { data: rotations, error: rotationsError } = await supabase
    .from("supper_rotations")
    .select("id, title, bring_list_enabled")
    .eq("org_id", orgId)
    .eq("status", "published")
    .in("group_id", groupIds);
  if (rotationsError) failed("supper_rotations", rotationsError, orgId);
  const running = new Map((rotations ?? []).map((s) => [s.id, { title: s.title, bringList: s.bring_list_enabled }]));
  if (running.size === 0) return none;

  const window = supperReadWindow(now);
  const rows: ReminderSupperRow[] = [];
  for (let from = 0;; from += PAGE) {
    const { data: suppers, error: suppersError } = await supabase
      .from("suppers")
      .select("id, group_id, rotation_id, table_id, starts_at, host_party_id")
      .eq("org_id", orgId)
      .in("rotation_id", [...running.keys()])
      .gte("starts_at", window.from)
      .lt("starts_at", window.to)
      .order("id")
      .range(from, from + PAGE - 1);
    if (suppersError) failed("suppers", suppersError, orgId);
    rows.push(...(suppers ?? []));
    if ((suppers ?? []).length < PAGE) return { rows, rotations: running };
  }
}

/** Who is at the supper's table, who hosts it and where, and what each guest brings. */
async function readDetails(
  supabase: SupperRemindersClient,
  orgId: string,
  supper: DueSupper,
  rotation: RotationInfo,
): Promise<{ details: SupperDetails; bringing: Map<string, string> }> {
  const { data: seats, error: seatsError } = await supabase
    .from("supper_seats")
    .select("party_id")
    .eq("org_id", orgId)
    .eq("table_id", supper.tableId)
    .is("left_at", null);
  if (seatsError) failed("supper_seats", seatsError, orgId);
  const partyIds = (seats ?? []).map((s) => s.party_id);

  const { data: members, error: membersError } = partyIds.length
    ? await supabase
      .from("supper_party_members")
      .select("party_id, profile_id")
      .eq("org_id", orgId)
      .in("party_id", partyIds)
    : { data: [], error: null };
  if (membersError) failed("supper_party_members", membersError, orgId);
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
    .from("supper_replies")
    .select("profile_id")
    .eq("org_id", orgId)
    .eq("supper_id", supper.supperId)
    .eq("status", "not_going");
  if (repliesError) failed("supper_replies", repliesError, orgId);
  const away = new Set((notGoing ?? []).map((r) => r.profile_id));

  let address: string | null = null;
  if (supper.hostPartyId) {
    const { data: rows, error: addressError } = await supabase
      .from("supper_party_addresses")
      .select("address_line1, address_line2, city, state, postal_code")
      .eq("org_id", orgId)
      .eq("party_id", supper.hostPartyId);
    if (addressError) failed("supper_party_addresses", addressError, orgId);
    address = rows?.[0] ? formatAddress(rows[0]) : null;
  }

  const bringing = new Map<string, string>();
  if (rotation.bringList) {
    const { data: items, error: itemsError } = await supabase
      .from("supper_contributions")
      .select("party_id, item")
      .eq("org_id", orgId)
      .eq("supper_id", supper.supperId);
    if (itemsError) failed("supper_contributions", itemsError, orgId);
    const itemOf = new Map((items ?? []).map((c) => [c.party_id, c.item]));
    for (const m of members ?? []) {
      const item = m.party_id === supper.hostPartyId ? undefined : itemOf.get(m.party_id);
      if (item) bringing.set(m.profile_id, item);
    }
  }

  const ordered = members ?? [];
  const details = {
    rotationTitle: rotation.title,
    hostNames:
      partyName(
        ordered.filter((m) => m.party_id === supper.hostPartyId).map((m) => nameOf.get(m.profile_id) ?? "").filter(Boolean),
      ) || null,
    address,
    coming: ordered
      .filter((m) => !away.has(m.profile_id))
      .map((m) => nameOf.get(m.profile_id) ?? "")
      .filter(Boolean),
  };
  return { details, bringing };
}

export async function runSupperReminders(
  supabase: SupperRemindersClient,
  orgs: Org[],
  deps: SupperRemindersDeps,
): Promise<SupperRemindersSummary> {
  let due = 0;
  let budgetExhausted = false;
  let rateLimited = false;
  let capped = 0;
  const outOfTime = () => deps.elapsed() >= deps.budgetMs;

  const results = await forEachOrg(orgs, async (org): Promise<OrgRunCounts> => {
    if (budgetExhausted || rateLimited) return { sent: 0, sendFailures: 0 };

    const { rows, rotations } = await readSuppers(supabase, org.id, deps.now);
    const suppers = dueSuppers(rows, org.timezone, deps.now);
    due += suppers.length;

    let sent = 0;
    let sendFailures = 0;
    const itemFailures: ItemFailure[] = [];
    let capReached = false;
    const send = deps.sender(org);

    for (const supper of suppers) {
      if (budgetExhausted || rateLimited) break;
      if (outOfTime()) {
        budgetExhausted = true;
        break;
      }

      const { data: claimed, error: claimError } = await supabase.rpc("supper_reminder_claim", {
        _org_id: org.id,
        _supper_id: supper.supperId,
        _supper_date: supper.supperDate,
        _starts_at: supper.startIso,
        _host_party_id: supper.hostPartyId,
      });
      if (claimError) {
        itemFailures.push({ item: supper.supperId, error: `supper_reminder_claim failed: ${claimError.message}` });
        continue;
      }
      const queue = claimed ?? [];
      if (queue.length === 0) continue;

      const sentIds: string[] = [];
      const releasedIds: string[] = [];
      let read: { details: SupperDetails; bringing: Map<string, string> } | null = null;
      try {
        read = await readDetails(supabase, org.id, supper, rotations.get(supper.rotationId) ?? { title: "", bringList: false });
      } catch (err) {
        itemFailures.push({ item: supper.supperId, error: err instanceof Error ? err.message : String(err) });
        releasedIds.push(...queue.map((row) => row.profile_id));
      }

      let sendFailed = false;
      for (const [index, row] of read ? queue.entries() : []) {
        if (!rateLimited && outOfTime()) budgetExhausted = true;
        if (budgetExhausted || rateLimited) {
          releasedIds.push(row.profile_id);
          continue;
        }
        if (capReached || !(await reserveEmailQuota(supabase, org.id, 1))) {
          if (!capReached) {
            capReached = true;
            logWarn("daily email cap reached, supper reminders past it are not sent", undefined, {
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
            supper,
            details: read!.details,
            profileId: row.profile_id,
            email: row.email,
            firstName: row.first_name,
            preferredName: row.preferred_name,
            bringing: read!.bringing.get(row.profile_id) ?? null,
          });
        } catch (err) {
          outcome = "retry";
          if (!sendFailed) {
            sendFailed = true;
            itemFailures.push({
              item: supper.supperId,
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
            .from("supper_reminder_sends")
            .update(values)
            .eq("org_id", org.id)
            .eq("supper_id", supper.supperId)
            .eq("supper_date", supper.supperDate)
            .in("profile_id", part);
          if (settleError) {
            itemFailures.push({ item: supper.supperId, error: `supper_reminder_sends update failed: ${settleError.message}` });
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
