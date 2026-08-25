/**
 * Org-branded email identity (CWA-10 Phase 3, #212; Phase 5 PR 7 / CWA-71).
 * The display name and Reply-To vary per org, and — once the org has a
 * `status = 'verified'` org_email_domains row whose domain passes
 * SENDING_DOMAIN — so does the From: address (`noreply@<domain>`). Every
 * other org keeps PLATFORM_ADDRESS (deliverability: SPF/DKIM are configured
 * for it).
 */
import { siteConfig } from "@/lib/config";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveOrgSlug, resolveRequestOrgId } from "@/lib/org";
import { BRANDING_DEFAULTS, getOrgBranding, resolveBranding } from "@/lib/branding";
import type { OrgBranding } from "@/lib/branding";

export type EmailBranding = {
  // Named orgName, not fromName: sendServingBroadcastEmail's own opts carry a
  // `fromName` that is a MEMBER's personal name ("Jane is looking for..."), and
  // both live in that one function body. Two same-named values, one of which
  // belongs in From: and one of which must never go there, is a swap waiting to
  // happen — and the swap would put a member's name on org mail with nothing to
  // catch it.
  orgName: string;
  replyTo: string | null;
  accent: string;
  accentLight: string;
  // The resolved From: address: `noreply@<domain>` when the org holds a
  // verified org_email_domains row whose domain passes SENDING_DOMAIN,
  // PLATFORM_ADDRESS in every other case. The local part is a fixed
  // constant — never admin-choosable.
  fromAddress: string;
};

// Names of only these characters are emitted unquoted. Deliberately narrower
// than RFC 5322 permits — and note `.` is NOT atext (RFC 5322 §3.2.3 lists it
// under specials; an unquoted "Dr. Smith" is legal only via the obsolete
// obs-phrase production, which every mainstream MTA still accepts).
// Everything outside this set takes the quoted-string branch below, which is
// always safe. Widening this set is never necessary; do not.
const PLAIN_NAME = /^[A-Za-z0-9 ._-]+$/;

// The org sending-domain gate (Phase 5 §10.3, CWA-71). A validation boundary
// with the same standing as PLAIN_NAME, not a style choice: the domain is
// admin-supplied text on the address side of the `<…>` in From:, which
// PLAIN_NAME and formatFromHeader()'s CR/LF strip do not cover. Same grammar
// as the claim-time DOMAIN_SHAPE in app/api/admin/email-domain/route.ts —
// stricter than the DB's own org_email_domains_domain_shape CHECK (lowercase
// + length only): lowercase LDH labels (1–63 chars each, no leading/trailing
// hyphen), at least one dot, 4–253 chars total — rejecting underscores,
// trailing dots, ports, whitespace, CR/LF, `@`, `<`/`>`, and any non-ASCII
// byte by construction. It performs no normalization: a non-canonical value
// fails and the platform address is used, never a "cleaned-up" version. It
// runs at SEND time on the value read back from the DB — because the DB
// CHECK alone would let a hand-edited or malformed row through, this is what
// makes such a row non-exploitable. Mirrored byte-for-byte in
// supabase/functions/_shared/branding.ts; a change lands on both sides.
const SENDING_DOMAIN =
  /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * RFC 5322 §3.4 From: header. Org display names are admin-supplied free
 * text: names outside the plain subset become a quoted-string with `\` and
 * `"` escaped, and CR/LF is stripped unconditionally (header injection).
 */
export function formatFromHeader(displayName: string, address: string): string {
  const name = displayName.replace(/[\r\n]/g, "").trim();
  if (name === "") return address;
  if (PLAIN_NAME.test(name)) return `${name} <${address}>`;
  return `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}" <${address}>`;
}

/** The bare address out of `two42 <noreply@example.org>` (or a bare addr). */
export function parseAddress(from: string): string {
  const match = from.match(/<([^<>]+)>\s*$/);
  return (match ? match[1] : from).trim();
}

/**
 * The platform sending address — the fallback From: for every org without a
 * verified sending domain, and for every failure branch below.
 */
export const PLATFORM_ADDRESS = parseAddress(siteConfig.email.from);

/**
 * The verified-status gate on the per-org From: address. Gated on equality
 * to 'verified' — never an enumerated list of fallback statuses; the status
 * vocabulary has already grown once and will again.
 */
function resolveFromAddress(
  domain: string | null | undefined,
  status: string | null | undefined,
): string {
  if (status !== "verified" || !domain) return PLATFORM_ADDRESS;
  if (!SENDING_DOMAIN.test(domain)) {
    console.error(
      "resolveEmailBranding: verified sending domain failed SENDING_DOMAIN, falling back to platform address:",
      domain,
    );
    return PLATFORM_ADDRESS;
  }
  return `noreply@${domain}`;
}

/**
 * Resolves the per-org From: address for a service-role-scoped orgId.
 * Total by contract, like getOrgBranding(): any failure — a returned
 * `error`, a missing row, or a thrown exception from the query itself —
 * logs and degrades to PLATFORM_ADDRESS. Never throws, so a sending-domain
 * failure can never take the rest of the branding lookup down with it.
 */
async function resolveOrgFromAddress(
  service: Awaited<ReturnType<typeof createServiceClient>>,
  orgId: string,
): Promise<string> {
  try {
    const { data: domainRow, error: domainError } = await service
      .from("org_email_domains")
      .select("domain, status")
      .eq("org_id", orgId)
      .maybeSingle();
    if (domainError) {
      console.error(
        "Failed to load sending domain for org %s, using platform address:",
        orgId,
        domainError,
      );
      return PLATFORM_ADDRESS;
    }
    return resolveFromAddress(domainRow?.domain, domainRow?.status);
  } catch (err) {
    console.error(
      "Failed to resolve sending domain for org %s, using platform address:",
      orgId,
      err,
    );
    return PLATFORM_ADDRESS;
  }
}

function toEmailBranding(b: OrgBranding, fromAddress: string): EmailBranding {
  return {
    orgName: b.display_name,
    replyTo: b.reply_to,
    accent: b.accent,
    // The branding contract has one color; the light variant stays the
    // platform constant rather than inventing a color-derivation scheme.
    accentLight: siteConfig.colors.primaryLight,
    fromAddress,
  };
}

/**
 * Branding for outbound email. With an orgId (callers that already hold one,
 * e.g. lib/serving/server.ts) this reads via the service-role client — RLS
 * is bypassed there, so the explicit .eq("id", orgId) / .eq("org_id", orgId)
 * filters are the ONLY tenant boundary; without one it falls back to the
 * request-scoped getOrgBranding(), then resolves an org id for the
 * sending-domain read via resolveRequestOrgId() on the cookie-bound request
 * client (the same value the RLS WITH CHECK evaluates).
 *
 * Fail-soft by contract: a branding lookup must never block an email, so any
 * failure logs and returns the platform defaults — and any failure on the
 * sending-domain side degrades only the From: address to PLATFORM_ADDRESS,
 * never the whole send.
 */
export async function resolveEmailBranding(orgId?: string): Promise<EmailBranding> {
  try {
    if (!orgId) {
      // The self-resolving path: branding comes from whatever org the request
      // resolves to, NOT from the row the caller is acting on. Correct only
      // while resolveOrgSlug() is host-independent (lib/org.ts) — Phase 5
      // custom domains make this the wrong org for any caller that had an
      // org_id in scope and did not pass it. This is the diagnostic to grep
      // for when that lands.
      console.debug("resolveEmailBranding: no orgId, resolving branding from the request org");
      const branding = await getOrgBranding();
      const requestClient = await createClient();
      const resolvedOrgId = await resolveRequestOrgId(requestClient, {
        label: "resolveEmailBranding",
        orgSlug: resolveOrgSlug(),
      });
      if (!resolvedOrgId) {
        // No org resolvable — fail closed to the platform address. Unlike the
        // public-funnel callers of resolveRequestOrgId(), "closed" here means
        // "send from PLATFORM_ADDRESS", not a blocked email.
        return toEmailBranding(branding, PLATFORM_ADDRESS);
      }
      const service = await createServiceClient();
      return toEmailBranding(branding, await resolveOrgFromAddress(service, resolvedOrgId));
    }
    const service = await createServiceClient();
    const { data, error } = await service
      .from("organizations")
      .select("branding")
      .eq("id", orgId)
      .maybeSingle();
    if (error) {
      console.error("Failed to load email branding for org %s, using defaults:", orgId, error);
      return toEmailBranding(BRANDING_DEFAULTS, PLATFORM_ADDRESS);
    }
    if (!data) {
      // Zero rows comes back as { data: null, error: null }, so it never
      // reaches the branch above. A service-role read that finds no row means
      // the orgId itself is stale or wrong-tenant — worth a signal, since the
      // defaults are indistinguishable from org #1's real branding.
      console.warn("No organizations row for org %s; using email branding defaults", orgId);
      return toEmailBranding(BRANDING_DEFAULTS, PLATFORM_ADDRESS);
    }
    return toEmailBranding(
      resolveBranding(data.branding),
      await resolveOrgFromAddress(service, orgId),
    );
  } catch (err) {
    console.error("Failed to load email branding, using defaults:", err);
    return toEmailBranding(BRANDING_DEFAULTS, PLATFORM_ADDRESS);
  }
}
