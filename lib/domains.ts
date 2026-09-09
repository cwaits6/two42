/**
 * Shared constants for the custom-domain feature (claim / verify / remove
 * routes, the admin and platform UIs). Pure values, no client — anything
 * that takes a Supabase client belongs in the routes, not here.
 */

// Mirrors the org_domains_domain_shape CHECK exactly (lowercase, 4–253
// chars, label shape). NOT app/api/admin/email-domain/route.ts's
// DOMAIN_SHAPE — that constant gates a different table and happens to be
// similar; keep the two independent so a change to one cannot loosen the
// other.
export const DOMAIN_SHAPE =
  /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

// verification_token is included on purpose: it is the value the admin has
// to publish, and SELECT is granted on the whole row.
export const DOMAIN_ROW_COLUMNS =
  "id, domain, status, verification_token, verified_at, attached_at, attach_claimed_at, last_checked_at, created_at";

/** The TXT record the verify route resolves: `<TXT_LABEL>.<domain>`. */
export const TXT_LABEL = "_two42-verify";

/**
 * Where a claimed name's CNAME (or apex A record) must point. Vercel shows
 * project-specific targets on the project's Domains page and requires the
 * exact records shown there, so both are deployment settings with Vercel's
 * generic values as the fallback. NEXT_PUBLIC_ because this module is
 * imported by client components; Next inlines these only when the full
 * variable name is written out.
 */
export const VERCEL_CNAME_TARGET =
  process.env.NEXT_PUBLIC_VERCEL_CNAME_TARGET?.trim() || "cname.vercel-dns.com";
export const VERCEL_APEX_A_RECORD =
  process.env.NEXT_PUBLIC_VERCEL_APEX_A_RECORD?.trim() || "76.76.21.21";

/**
 * The attachment worker's single-flight lease window. Mirrored by
 * ATTACH_LEASE_WINDOW_MS in supabase/functions/_shared/domain-lease.ts
 * (edge functions cannot import from lib/): the platform retry route clears
 * only leases older than this, and the UI reports a lease as expired on the
 * same boundary. A change lands on both sides.
 */
export const ATTACH_LEASE_WINDOW_MS = 10 * 60 * 1000;
