// Supper club emails sent from the app: the tables once published, a
// supper's new date once moved, and a supper that is off once its date is
// deleted. The recipients' addresses are readable only
// on the service client, so every chain here filters on the orgId the route
// resolved from the caller's session, and recipients come only from the
// seats of the tables concerned.

import { formatFromHeader, resolveEmailBranding } from "@/lib/email/identity";
import { reserveEmailQuota } from "@/lib/email/quota";
import { sendEmail } from "@/lib/email/send";
import { siteConfig } from "@/lib/config";
import { logError, logWarn } from "@/lib/log";
import { createServiceClient } from "@/lib/supabase/server";
import { orgTimeZoneById } from "@/lib/time/orgZone";
import {
  supperCancelledEmail,
  supperMovedEmail,
  supperTablesEmail,
  greetingName,
  type RenderedEmail,
} from "@/supabase/functions/_shared/email-html";
import type { NotifyResult } from "./emailOutcome";
import { supperWhen, partyName } from "./labels";

const NOTHING: NotifyResult = { sent: 0, failed: 0, capped: false };

type Service = Awaited<ReturnType<typeof createServiceClient>>;

interface Recipient {
  id: string;
  email: string;
  name: string | null;
}

/** The people who get Supper club email, of those named, in this church. */
async function recipients(service: Service, orgId: string, profileIds: string[]): Promise<Map<string, Recipient>> {
  if (profileIds.length === 0) return new Map();
  const { data, error } = await service
    .from("profiles")
    .select("id, email, first_name, preferred_name, role, email_supper_club")
    .eq("org_id", orgId)
    .in("id", profileIds);
  if (error) throw new Error("Failed to load Supper club recipients");
  return new Map(
    (data ?? [])
      .filter((p) => p.role !== "pending" && p.email && p.email_supper_club)
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
  if (error) throw new Error("Failed to load Supper club names");
  return new Map((data ?? []).map((p) => [p.id, greetingName(p.preferred_name, p.first_name) ?? ""]));
}

/** Each party's people, for the parties named. */
async function partyPeople(service: Service, orgId: string, partyIds: string[]): Promise<Map<string, string[]>> {
  const byParty = new Map<string, string[]>();
  if (partyIds.length === 0) return byParty;
  const { data, error } = await service
    .from("supper_party_members")
    .select("party_id, profile_id")
    .eq("org_id", orgId)
    .in("party_id", partyIds);
  if (error) throw new Error("Failed to load Supper club parties");
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
    logWarn("Daily email cap reached, Supper club emails not sent", undefined, {
      ids: { org: orgId, skipped: messages.length },
    });
    return { sent: 0, failed: 0, capped: true };
  }
  const b = await resolveEmailBranding(orgId);
  let sent = 0;
  let failed = 0;
  for (const { to, build } of messages) {
    const email = build({ orgName: b.orgName, accent: b.accent });
    try {
      const { error } = await sendEmail({
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
      logError("Failed to send a Supper club email", err, { ids: { org: orgId, profile: to.id } });
    }
  }
  return { sent, failed, capped: false };
}

function pageUrl(groupId: string): string {
  return `${siteConfig.url}/g/${groupId}/supper-club`;
}

/** One email per person whose tables changed: their suppers, dates and hosts. */
export async function notifyTablesPublished(
  orgId: string,
  rotationId: string,
  profileIds: string[],
): Promise<NotifyResult> {
  if (profileIds.length === 0) return NOTHING;
  const service = await createServiceClient();

  const { data: rotation, error: rotationError } = await service
    .from("supper_rotations")
    .select("id, group_id, title")
    .eq("org_id", orgId)
    .eq("id", rotationId)
    .eq("status", "published")
    .maybeSingle();
  if (rotationError) throw new Error("Failed to load the Supper club rotation");
  // An ended rotation sends no more supper email.
  if (!rotation) return NOTHING;

  const to = await recipients(service, orgId, profileIds);
  if (to.size === 0) return NOTHING;

  const { data: memberships, error: membershipsError } = await service
    .from("supper_party_members")
    .select("party_id, profile_id")
    .eq("org_id", orgId)
    .eq("rotation_id", rotationId)
    .in("profile_id", [...to.keys()]);
  if (membershipsError) throw new Error("Failed to load Supper club parties");
  const partyOf = new Map((memberships ?? []).map((m) => [m.profile_id, m.party_id]));

  const { data: seats, error: seatsError } = await service
    .from("supper_seats")
    .select("table_id, party_id")
    .eq("org_id", orgId)
    .eq("rotation_id", rotationId)
    .is("left_at", null)
    .in("party_id", [...new Set(partyOf.values())]);
  if (seatsError) throw new Error("Failed to load Supper club seats");

  const tableIds = [...new Set((seats ?? []).map((s) => s.table_id))];
  const { data: suppers, error: suppersError } = tableIds.length
    ? await service
        .from("suppers")
        .select("id, table_id, starts_at, host_party_id")
        .eq("org_id", orgId)
        .in("table_id", tableIds)
        .order("starts_at")
    : { data: [], error: null };
  if (suppersError) throw new Error("Failed to load suppers");

  const hostParties = await partyPeople(service, orgId, [
    ...new Set((suppers ?? []).map((d) => d.host_party_id).filter((id): id is string => Boolean(id))),
  ]);
  const names = await firstNames(service, orgId, [...hostParties.values()].flat());
  const zone = await orgTimeZoneById(service, orgId);

  const messages = [...to.values()].flatMap((person): Message[] => {
    const party = partyOf.get(person.id);
    const tables = new Set((seats ?? []).filter((s) => s.party_id === party).map((s) => s.table_id));
    const mine = (suppers ?? []).filter((d) => tables.has(d.table_id));
    if (mine.length === 0) return [];
    return [
      {
        to: person,
        build: (brand) =>
          supperTablesEmail({
            ...brand,
            name: person.name,
            rotationTitle: rotation.title,
            suppers: mine.map((d) => ({
              dateLabel: supperWhen(d.starts_at, zone),
              hostNames: d.host_party_id
                ? partyName((hostParties.get(d.host_party_id) ?? []).map((id) => names.get(id) ?? "").filter(Boolean))
                : null,
            })),
            pageUrl: pageUrl(rotation.group_id),
          }),
      },
    ];
  });
  return send(orgId, messages);
}

/**
 * One email per person at each moved supper's table, with the old and new
 * date. The person who moved it gets none.
 */
export async function notifySuppersMoved(
  orgId: string,
  moves: { supperId: string; oldStartsAt: string }[],
  actorId: string,
): Promise<NotifyResult> {
  if (moves.length === 0) return NOTHING;
  const service = await createServiceClient();

  const { data: suppers, error: suppersError } = await service
    .from("suppers")
    .select("id, table_id, rotation_id, group_id, starts_at")
    .eq("org_id", orgId)
    .in(
      "id",
      moves.map((m) => m.supperId),
    );
  if (suppersError) throw new Error("Failed to load suppers");

  const rotationIds = [...new Set((suppers ?? []).map((d) => d.rotation_id))];
  const { data: rotations, error: rotationsError } = rotationIds.length
    ? await service
        .from("supper_rotations")
        .select("id, title")
        .eq("org_id", orgId)
        .eq("status", "published")
        .in("id", rotationIds)
    : { data: [], error: null };
  if (rotationsError) throw new Error("Failed to load Supper club rotations");
  // Only a running rotation's suppers: an ended rotation sends no more supper email.
  const titles = new Map((rotations ?? []).map((s) => [s.id, s.title]));

  const tableIds = [...new Set((suppers ?? []).map((d) => d.table_id))];
  const { data: seats, error: seatsError } = tableIds.length
    ? await service
        .from("supper_seats")
        .select("table_id, party_id")
        .eq("org_id", orgId)
        .is("left_at", null)
        .in("table_id", tableIds)
    : { data: [], error: null };
  if (seatsError) throw new Error("Failed to load Supper club seats");

  const people = await partyPeople(service, orgId, [...new Set((seats ?? []).map((s) => s.party_id))]);
  const to = await recipients(
    service,
    orgId,
    [...people.values()].flat().filter((id) => id !== actorId),
  );
  const zone = await orgTimeZoneById(service, orgId);

  const messages = (suppers ?? []).flatMap((d): Message[] => {
    const move = moves.find((m) => m.supperId === d.id);
    const rotationTitle = titles.get(d.rotation_id);
    if (!move || !rotationTitle || move.oldStartsAt === d.starts_at) return [];
    const atTable = (seats ?? []).filter((s) => s.table_id === d.table_id).flatMap((s) => people.get(s.party_id) ?? []);
    return atTable.flatMap((id) => {
      const person = to.get(id);
      if (!person) return [];
      return [
        {
          to: person,
          build: (brand) =>
            supperMovedEmail({
              ...brand,
              name: person.name,
              rotationTitle,
              oldDateLabel: supperWhen(move.oldStartsAt, zone),
              newDateLabel: supperWhen(d.starts_at, zone),
              pageUrl: pageUrl(d.group_id),
            }),
        },
      ];
    });
  });
  return send(orgId, messages);
}

/**
 * The emails for a rotation date about to be deleted: one to each person at
 * each of its suppers, saying it's off, and none to the person deleting it.
 * Read before the delete, because the date's suppers go with it, and so do
 * the tables and seats of a rotation whose tables change each supper. Call
 * the answer once the delete is saved.
 */
export async function prepareDateDeletedEmails(
  orgId: string,
  dateId: string,
  actorId: string,
): Promise<() => Promise<NotifyResult>> {
  const service = await createServiceClient();

  const { data: suppers, error: suppersError } = await service
    .from("suppers")
    .select("id, table_id, rotation_id, group_id, starts_at")
    .eq("org_id", orgId)
    .eq("rotation_date_id", dateId)
    .order("starts_at");
  if (suppersError) throw new Error("Failed to load suppers");
  if (!suppers?.length) return async () => NOTHING;

  const { data: rotation, error: rotationError } = await service
    .from("supper_rotations")
    .select("id, title")
    .eq("org_id", orgId)
    .eq("id", suppers[0].rotation_id)
    .eq("status", "published")
    .maybeSingle();
  if (rotationError) throw new Error("Failed to load the Supper club rotation");
  // An ended rotation sends no more supper email.
  if (!rotation) return async () => NOTHING;

  const { data: seats, error: seatsError } = await service
    .from("supper_seats")
    .select("table_id, party_id")
    .eq("org_id", orgId)
    .is("left_at", null)
    .in("table_id", [...new Set(suppers.map((d) => d.table_id))]);
  if (seatsError) throw new Error("Failed to load Supper club seats");

  const people = await partyPeople(service, orgId, [...new Set((seats ?? []).map((s) => s.party_id))]);
  const to = await recipients(
    service,
    orgId,
    [...people.values()].flat().filter((id) => id !== actorId),
  );
  const zone = await orgTimeZoneById(service, orgId);

  const emailed = new Set<string>();
  const messages = suppers.flatMap((d): Message[] =>
    (seats ?? [])
      .filter((s) => s.table_id === d.table_id)
      .flatMap((s) => people.get(s.party_id) ?? [])
      .flatMap((id) => {
        const person = to.get(id);
        if (!person || emailed.has(id)) return [];
        emailed.add(id);
        return [
          {
            to: person,
            build: (brand) =>
              supperCancelledEmail({
                ...brand,
                name: person.name,
                rotationTitle: rotation.title,
                dateLabel: supperWhen(d.starts_at, zone),
                pageUrl: pageUrl(d.group_id),
              }),
          },
        ];
      }),
  );
  return () => send(orgId, messages);
}
