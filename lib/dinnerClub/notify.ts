// Dinner club emails sent from the app: the tables once published, and a
// dinner's new date once moved. The recipients' addresses are readable only
// on the service client, so every chain here filters on the orgId the route
// resolved from the caller's session, and recipients come only from the
// seats of the tables concerned.

import { Resend } from "resend";
import { formatFromHeader, resolveEmailBranding } from "@/lib/email/identity";
import { reserveEmailQuota } from "@/lib/email/quota";
import { siteConfig } from "@/lib/config";
import { logError, logWarn } from "@/lib/log";
import { createServiceClient } from "@/lib/supabase/server";
import { orgTimeZoneById } from "@/lib/time/orgZone";
import {
  dinnerMovedEmail,
  dinnerTablesEmail,
  greetingName,
  type RenderedEmail,
} from "@/supabase/functions/_shared/email-html";
import type { NotifyResult } from "./emailOutcome";
import { dinnerWhen, partyName } from "./labels";

const NOTHING: NotifyResult = { sent: 0, failed: 0, capped: false };

type Service = Awaited<ReturnType<typeof createServiceClient>>;

interface Recipient {
  id: string;
  email: string;
  name: string | null;
}

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

/** The people who get dinner club email, of those named, in this church. */
async function recipients(service: Service, orgId: string, profileIds: string[]): Promise<Map<string, Recipient>> {
  if (profileIds.length === 0) return new Map();
  const { data, error } = await service
    .from("profiles")
    .select("id, email, first_name, preferred_name, role, email_dinner_club")
    .eq("org_id", orgId)
    .in("id", profileIds);
  if (error) throw new Error("Failed to load dinner club recipients");
  return new Map(
    (data ?? [])
      .filter((p) => p.role !== "pending" && p.email && p.email_dinner_club)
      .map((p) => [p.id, { id: p.id, email: p.email as string, name: greetingName(p.preferred_name, p.first_name) }]),
  );
}

/** First names by person, for host names. */
async function firstNames(service: Service, orgId: string, profileIds: string[]): Promise<Map<string, string>> {
  if (profileIds.length === 0) return new Map();
  const { data, error } = await service
    .from("profiles")
    .select("id, first_name, preferred_name")
    .eq("org_id", orgId)
    .in("id", profileIds);
  if (error) throw new Error("Failed to load dinner club names");
  return new Map((data ?? []).map((p) => [p.id, greetingName(p.preferred_name, p.first_name) ?? ""]));
}

/** Each party's people, for the parties named. */
async function partyPeople(service: Service, orgId: string, partyIds: string[]): Promise<Map<string, string[]>> {
  const byParty = new Map<string, string[]>();
  if (partyIds.length === 0) return byParty;
  const { data, error } = await service
    .from("dinner_party_members")
    .select("party_id, profile_id")
    .eq("org_id", orgId)
    .in("party_id", partyIds);
  if (error) throw new Error("Failed to load dinner club parties");
  for (const row of data ?? []) byParty.set(row.party_id, [...(byParty.get(row.party_id) ?? []), row.profile_id]);
  return byParty;
}

type Brand = { orgName: string; accent: string };

interface Message {
  to: Recipient;
  build: (brand: Brand) => RenderedEmail;
}

async function send(orgId: string, messages: Message[]): Promise<NotifyResult> {
  if (messages.length === 0) return NOTHING;
  if (!(await reserveEmailQuota(orgId, messages.length))) {
    logWarn("Daily email cap reached, dinner club emails not sent", undefined, {
      ids: { org: orgId, skipped: messages.length },
    });
    return { sent: 0, failed: 0, capped: true };
  }
  const b = await resolveEmailBranding(orgId);
  const resend = getResend();
  let sent = 0;
  let failed = 0;
  for (const { to, build } of messages) {
    const email = build({ orgName: b.orgName, accent: b.accent });
    try {
      const { error } = await resend.emails.send({
        from: formatFromHeader(b.orgName, b.fromAddress),
        to: to.email,
        ...(b.replyTo ? { replyTo: b.replyTo } : {}),
        subject: email.subject,
        html: email.html,
      });
      if (error) throw error;
      sent++;
    } catch (err) {
      failed++;
      logError("Failed to send a dinner club email", err, { ids: { org: orgId, profile: to.id } });
    }
  }
  return { sent, failed, capped: false };
}

function pageUrl(groupId: string): string {
  return `${siteConfig.url}/g/${groupId}/dinner-club`;
}

/** One email per person whose tables changed: their dinners, dates and hosts. */
export async function notifyTablesPublished(
  orgId: string,
  seasonId: string,
  profileIds: string[],
): Promise<NotifyResult> {
  if (profileIds.length === 0) return NOTHING;
  const service = await createServiceClient();

  const { data: season, error: seasonError } = await service
    .from("dinner_seasons")
    .select("id, group_id, title")
    .eq("org_id", orgId)
    .eq("id", seasonId)
    .maybeSingle();
  if (seasonError || !season) throw new Error("Failed to load the dinner club season");

  const to = await recipients(service, orgId, profileIds);
  if (to.size === 0) return NOTHING;

  const { data: memberships, error: membershipsError } = await service
    .from("dinner_party_members")
    .select("party_id, profile_id")
    .eq("org_id", orgId)
    .eq("season_id", seasonId)
    .in("profile_id", [...to.keys()]);
  if (membershipsError) throw new Error("Failed to load dinner club parties");
  const partyOf = new Map((memberships ?? []).map((m) => [m.profile_id, m.party_id]));

  const { data: seats, error: seatsError } = await service
    .from("dinner_seats")
    .select("table_id, party_id")
    .eq("org_id", orgId)
    .eq("season_id", seasonId)
    .is("left_at", null)
    .in("party_id", [...new Set(partyOf.values())]);
  if (seatsError) throw new Error("Failed to load dinner club seats");

  const tableIds = [...new Set((seats ?? []).map((s) => s.table_id))];
  const { data: dinners, error: dinnersError } = tableIds.length
    ? await service
        .from("dinners")
        .select("id, table_id, starts_at, host_party_id")
        .eq("org_id", orgId)
        .in("table_id", tableIds)
        .order("starts_at")
    : { data: [], error: null };
  if (dinnersError) throw new Error("Failed to load dinners");

  const hostParties = await partyPeople(service, orgId, [
    ...new Set((dinners ?? []).map((d) => d.host_party_id).filter((id): id is string => Boolean(id))),
  ]);
  const names = await firstNames(service, orgId, [...hostParties.values()].flat());
  const zone = await orgTimeZoneById(service, orgId);

  const messages = [...to.values()].flatMap((person): Message[] => {
    const party = partyOf.get(person.id);
    const tables = new Set((seats ?? []).filter((s) => s.party_id === party).map((s) => s.table_id));
    const mine = (dinners ?? []).filter((d) => tables.has(d.table_id));
    if (mine.length === 0) return [];
    return [
      {
        to: person,
        build: (brand) =>
          dinnerTablesEmail({
            ...brand,
            name: person.name,
            seasonTitle: season.title,
            dinners: mine.map((d) => ({
              dateLabel: dinnerWhen(d.starts_at, zone),
              hostNames: d.host_party_id
                ? partyName((hostParties.get(d.host_party_id) ?? []).map((id) => names.get(id) ?? "").filter(Boolean))
                : null,
            })),
            pageUrl: pageUrl(season.group_id),
          }),
      },
    ];
  });
  return send(orgId, messages);
}

/**
 * One email per person at each moved dinner's table, with the old and new
 * date. The person who moved it gets none.
 */
export async function notifyDinnersMoved(
  orgId: string,
  moves: { dinnerId: string; oldStartsAt: string }[],
  actorId: string,
): Promise<NotifyResult> {
  if (moves.length === 0) return NOTHING;
  const service = await createServiceClient();

  const { data: dinners, error: dinnersError } = await service
    .from("dinners")
    .select("id, table_id, season_id, group_id, starts_at")
    .eq("org_id", orgId)
    .in(
      "id",
      moves.map((m) => m.dinnerId),
    );
  if (dinnersError) throw new Error("Failed to load dinners");

  const seasonIds = [...new Set((dinners ?? []).map((d) => d.season_id))];
  const { data: seasons, error: seasonsError } = seasonIds.length
    ? await service.from("dinner_seasons").select("id, title").eq("org_id", orgId).in("id", seasonIds)
    : { data: [], error: null };
  if (seasonsError) throw new Error("Failed to load dinner club seasons");
  const titles = new Map((seasons ?? []).map((s) => [s.id, s.title]));

  const tableIds = [...new Set((dinners ?? []).map((d) => d.table_id))];
  const { data: seats, error: seatsError } = tableIds.length
    ? await service
        .from("dinner_seats")
        .select("table_id, party_id")
        .eq("org_id", orgId)
        .is("left_at", null)
        .in("table_id", tableIds)
    : { data: [], error: null };
  if (seatsError) throw new Error("Failed to load dinner club seats");

  const people = await partyPeople(service, orgId, [...new Set((seats ?? []).map((s) => s.party_id))]);
  const to = await recipients(
    service,
    orgId,
    [...people.values()].flat().filter((id) => id !== actorId),
  );
  const zone = await orgTimeZoneById(service, orgId);

  const messages = (dinners ?? []).flatMap((d): Message[] => {
    const move = moves.find((m) => m.dinnerId === d.id);
    if (!move || move.oldStartsAt === d.starts_at) return [];
    const atTable = (seats ?? []).filter((s) => s.table_id === d.table_id).flatMap((s) => people.get(s.party_id) ?? []);
    return atTable.flatMap((id) => {
      const person = to.get(id);
      if (!person) return [];
      return [
        {
          to: person,
          build: (brand) =>
            dinnerMovedEmail({
              ...brand,
              name: person.name,
              seasonTitle: titles.get(d.season_id) ?? "Dinner club",
              oldDateLabel: dinnerWhen(move.oldStartsAt, zone),
              newDateLabel: dinnerWhen(d.starts_at, zone),
              pageUrl: pageUrl(d.group_id),
            }),
        },
      ];
    });
  });
  return send(orgId, messages);
}
