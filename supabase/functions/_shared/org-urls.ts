// Per-org link origin for the cron Edge Functions.
//
// A DELIBERATE MIRROR of lib/org-urls.ts's computeOrgOrigin(). Edge
// functions cannot import from lib/, exactly as with _shared/branding.ts —
// see that file's header for the full reasoning. ORG_DOMAIN_SHAPE is a
// routing/injection boundary, not a style choice; a change here must be
// made in lib/org-urls.ts too, and vice versa.
//
// Differences from the app version (all deliberate):
//   - The platform apex and platform URL are passed in by the caller (the
//     env-derived PLATFORM_APEX / SITE_URL) rather than read from siteConfig.
//   - No DB read here — the org_domains rows arrive on the listActiveOrgs
//     row, so this module stays supabase-js-free and offline-testable,
//     matching the stated design of _shared/orgs.ts.

export interface OrgDomainRow {
  domain: string;
  status: string;
  attached_at: string | null;
}

const ORG_DOMAIN_SHAPE =
  /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * See lib/org-urls.ts's computeOrgOrigin() for the full contract: a custom
 * domain wins only when its row is `verified` AND `attached_at` is set
 * (ownership plus routing), the earliest-attached row wins if several are,
 * a stored domain that fails ORG_DOMAIN_SHAPE falls through with a log, and
 * the fallbacks are `https://<slug>.<platformApex>` then `platformUrl`.
 */
export function computeOrgOrigin(
  slug: string | null | undefined,
  domains: OrgDomainRow[] | null | undefined,
  platformApex: string,
  platformUrl: string,
): string {
  const attached = (domains ?? [])
    .filter((d) => d.status === "verified" && d.attached_at !== null)
    .sort((a, b) => (a.attached_at! < b.attached_at! ? -1 : 1))[0];
  if (attached) {
    if (ORG_DOMAIN_SHAPE.test(attached.domain)) {
      return `https://${attached.domain}`;
    }
    console.error(
      "orgBaseUrl: verified+attached domain failed ORG_DOMAIN_SHAPE for org %s, falling back:",
      slug,
      attached.domain,
    );
  }
  if (slug) return `https://${slug}.${platformApex}`;
  return platformUrl;
}
