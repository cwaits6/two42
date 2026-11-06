/**
 * Server-side serving helpers shared by the in-app signup API and the
 * signed email-link API. Callers wrap these in try/catch — email failures
 * must never undo a successful signup or cancel.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { displayName } from "@/lib/names";
import { generateServingICS } from "@/lib/ics-utils";
import { getServingLinkMode } from "@/lib/serving/config";
import { signupDisplayName } from "@/lib/serving/display";
import { createServingToken } from "@/lib/serving/links";
import {
  sendServingCancelNoticeEmail,
  sendServingConfirmationEmail,
} from "@/lib/email/serving";
import { resolveEmailBranding } from "@/lib/email/identity";
import { reserveEmailQuota } from "@/lib/email/quota";
import { siteConfig } from "@/lib/config";
import { logError, logWarn } from "@/lib/log";

export interface NamedProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}

export interface SpouseProfile extends NamedProfile {
  email: string | null;
}

/** The two household roles that make a couple; nobody else is offered a spouse choice. */
export const COUPLE_RELATIONSHIPS = ["primary", "spouse"] as const;

export function isCoupleMember(p: { family_id: string | null; relationship: string | null }): p is {
  family_id: string;
  relationship: "primary" | "spouse";
} {
  return p.family_id !== null && (COUPLE_RELATIONSHIPS as readonly string[]).includes(p.relationship ?? "");
}

/**
 * The viewer's spouse as someone who can serve with them: the other primary
 * or spouse in their household, only when the viewer is one of those two
 * themself, and only while the spouse is on the team — being on the team is
 * the one rule for who can be put on a date. Non-fatal by contract:
 * everywhere the spouse appears it is an opt-in extra, so a failed read logs
 * and degrades to null rather than throwing.
 */
export async function findSpouse(
  supabase: SupabaseClient,
  viewer: { id: string; family_id: string | null; relationship: string | null },
  orgId: string,
  teamId: string
): Promise<SpouseProfile | null> {
  if (!isCoupleMember(viewer)) return null;
  // org_id filter is required: on a service-role client a key-only read
  // matches rows from every org the moment a second org exists. The profile
  // embed is org-safe by the composite FK from the org-filtered roster row.
  const { data: member, error } = await supabase
    .from("team_members")
    .select("profiles!inner(id, first_name, last_name, preferred_name, email)")
    .eq("team_id", teamId)
    .eq("org_id", orgId)
    .eq("profiles.family_id", viewer.family_id)
    .in("profiles.relationship", [...COUPLE_RELATIONSHIPS])
    .neq("profiles.id", viewer.id)
    .limit(1)
    .maybeSingle();
  if (error) {
    logError("Serving spouse lookup failed for family", error, { ids: { family: viewer.family_id } });
  }
  return (member?.profiles as SpouseProfile | null | undefined) ?? null;
}

export async function sendSignupConfirmation(
  supabase: SupabaseClient,
  opts: {
    signupId: string;
    orgId: string;
    /** The team's group: resolves the link mode and the page the links open. */
    groupId: string;
    teamId: string;
    teamName: string;
    serviceDate: string;
    attendees: NamedProfile[];
    recipient: { id: string; email: string; name: string };
  }
) {
  const attendeesLabel = signupDisplayName(opts.attendees);

  // resolveEmailBranding never throws — it degrades to platform defaults —
  // so this needs no guard of its own.
  const branding = await resolveEmailBranding(opts.orgId);
  const baseUrl = siteConfig.url;

  const linkMode = await getServingLinkMode(supabase, opts.orgId, opts.groupId);
  const cancelUrl =
    linkMode === "signed"
      ? `${baseUrl}/serving/go?token=${createServingToken({
          a: "cancel",
          g: opts.teamId,
          d: opts.serviceDate,
          p: opts.recipient.id,
        })}`
      : `${baseUrl}/g/${opts.groupId}/serving/${opts.teamId}`;

  await sendServingConfirmationEmail({
    to: opts.recipient.email,
    name: opts.recipient.name,
    teamName: opts.teamName,
    serviceDate: opts.serviceDate,
    attendeesLabel,
    cancelUrl,
    icsContent: generateServingICS({
      signupId: opts.signupId,
      serviceDate: opts.serviceDate,
      teamName: opts.teamName,
    }),
    branding,
  });
}

/** Quietly tell the team's leaders Sundays opened back up, reading them once and sending one notice per date. */
export async function notifyLeadersOfCancel(
  service: SupabaseClient,
  opts: {
    /** The team's group: the page the link opens lives under it. */
    groupId: string;
    teamId: string;
    orgId: string;
    teamName: string;
    serviceDates: string[];
    memberLabel: string;
    excludeProfileId?: string;
  }
) {
  // orgId is required rather than self-resolving: this function's anonymous
  // signed-link caller has no session to resolve an org from. Every caller
  // holds an already-authorized org_id and passes it.

  // org_id filter is required: this is an email fan-out surface on a
  // service-role client — an unscoped read would mail another org's leaders.
  const { data: leaders, error } = await service
    .from("team_members")
    .select("profiles(id, first_name, last_name, preferred_name, email, role)")
    .eq("team_id", opts.teamId)
    .eq("org_id", opts.orgId)
    .eq("is_leader", true);

  // Non-throwing by contract (see file header), but a failed read here is not
  // a graceful degradation — it means the team's leaders are never told the
  // slot opened, with no other signal that it happened. Log it.
  if (error) {
    // The code only: a PostgrestError's details echo row content.
    logError("Serving leaders lookup failed for team", error, { ids: { team: opts.teamId, org: opts.orgId } });
  }

  // Filter to the final sendable set first, then reserve once for its size
  // against the org's daily cap — the same "filter, then reserve
  // per batch" ordering as app/api/serving/broadcast/route.ts. A refused
  // reservation is a skip, preserving this function's non-throwing contract
  // (reserveEmailQuota itself never throws).
  const recipients = (leaders ?? [])
    .map(
      (row) =>
        row.profiles as unknown as
          | (NamedProfile & { email: string | null; role: string })
          | null,
    )
    .filter(
      (p): p is NamedProfile & { email: string; role: string } =>
        !!p?.email && p.role !== "pending" && p.id !== opts.excludeProfileId,
    );

  if (recipients.length === 0) return;

  // Resolved only once there is someone to mail — a service-role
  // organizations read, wasted when the team has no sendable leaders.
  const branding = await resolveEmailBranding(opts.orgId);
  const baseUrl = siteConfig.url;

  const allowed = await reserveEmailQuota(opts.orgId, recipients.length * opts.serviceDates.length);
  if (!allowed) {
    logWarn("Serving cancel notice skipped — org hit its daily email cap", undefined, { ids: { org: opts.orgId } });
    return;
  }

  for (const serviceDate of opts.serviceDates) {
    for (const leader of recipients) {
      try {
        await sendServingCancelNoticeEmail({
          to: leader.email,
          leaderName: displayName(leader),
          memberLabel: opts.memberLabel,
          teamName: opts.teamName,
          serviceDate,
          servingUrl: `${baseUrl}/g/${opts.groupId}/serving/${opts.teamId}`,
          branding,
        });
      } catch (err) {
        // A provider's message can echo the address.
        logError("Failed to send serving cancel notice to leader", err, { ids: { leader: leader.id } });
      }
    }
  }
}
