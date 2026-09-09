/**
 * Per-org link origins for outbound email. Every link the platform mails —
 * invites, family invites, serving action links, reminders — must point at
 * the recipient's own org host, not the deployment's env-pinned
 * `siteConfig.url`: on a custom domain the platform host resolves a
 * different org, and the token flows fail closed there (a broken link, not
 * a leak — but the whole onboarding funnel for that org).
 */
import { createServiceClient } from "@/lib/supabase/server";
import { siteConfig } from "@/lib/config";

// The org custom-domain gate. Same standing as SENDING_DOMAIN in
// lib/email/identity.ts: the DB's org_domains_domain_shape CHECK runs only
// at INSERT time, so a hand-edited or malformed row could otherwise reach an
// emailed link unvalidated. Re-run here, at USE time, on every read — same
// grammar (lowercase LDH labels, at least one dot, 4–253 chars, no
// underscores/ports/whitespace/CR-LF/`@`/`<`/`>`), no normalization: a
// non-canonical value falls through to the subdomain rather than being
// "cleaned up". Mirrored byte-for-byte in
// supabase/functions/_shared/org-urls.ts; a change lands on both sides.
const ORG_DOMAIN_SHAPE =
  /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export interface OrgDomainRow {
  domain: string;
  status: string;
  attached_at: string | null;
}

/**
 * The org-origin selection rule: a custom domain wins only when its row is
 * `verified` AND `attached_at` is set. `verified` alone proves ownership,
 * not routing — the attachment worker stamps `attached_at` once the host
 * actually routes here, and an emailed link must never point at a host
 * that does not route yet. Falls through to the wildcard subdomain, then to
 * siteConfig.url. Pure — no DB access — so orgBaseUrl() below is the only
 * caller that fetches anything and the branching is testable without a
 * Supabase stub.
 *
 * If more than one row is verified+attached (nothing forbids it at the
 * schema level, even though the attachment flow is expected to keep it to
 * one), the earliest-attached row wins — deterministic, and stable across
 * repeated calls for the same org state.
 */
export function computeOrgOrigin(
  slug: string | null | undefined,
  domains: OrgDomainRow[] | null | undefined
): string {
  const attached = (domains ?? [])
    .filter((d) => d.status === "verified" && d.attached_at !== null)
    .sort((a, b) => (a.attached_at! < b.attached_at! ? -1 : 1))[0];
  if (attached) {
    if (ORG_DOMAIN_SHAPE.test(attached.domain)) {
      return `https://${attached.domain}`;
    }
    console.error(
      "orgBaseUrl: verified+attached domain failed ORG_DOMAIN_SHAPE, falling back:",
      attached.domain
    );
  }
  if (slug) return `https://${slug}.${siteConfig.platformApex}`;
  return siteConfig.url;
}

/**
 * The org's canonical origin for a link inside an outbound email. Reads via
 * the service-role client — RLS is bypassed, so `.eq("id", orgId)` is the
 * only tenant boundary, the same contract resolveEmailBranding() uses.
 * `orgId` must be the caller's already-validated anchor — never a header,
 * never a request-body field. Never throws: any failure logs and degrades
 * to siteConfig.url, matching resolveEmailBranding()'s fail-soft contract —
 * a broken link-origin lookup must never block an email.
 */
export async function orgBaseUrl(orgId: string): Promise<string> {
  try {
    const service = await createServiceClient();
    const { data, error } = await service
      .from("organizations")
      .select("slug, org_domains(domain, status, attached_at)")
      .eq("id", orgId)
      .maybeSingle();
    if (error) {
      console.error("orgBaseUrl: failed to load org %s, using platform URL:", orgId, error);
      return siteConfig.url;
    }
    if (!data) {
      // Zero rows is { data: null, error: null }, so it never reaches the
      // branch above. A service-role read that finds no row means the orgId
      // itself is stale or wrong-tenant — worth a signal.
      console.warn("orgBaseUrl: no organizations row for org %s; using platform URL", orgId);
      return siteConfig.url;
    }
    return computeOrgOrigin(data.slug, data.org_domains);
  } catch (err) {
    console.error("orgBaseUrl: failed to resolve org %s, using platform URL:", orgId, err);
    return siteConfig.url;
  }
}
