// Type-only import — erased at compile time. resolveRequestOrgId() takes the
// client as a PARAMETER, never constructs one: this module is reachable from
// the client bundle (lib/supabase/client.ts → app/join/JoinForm.tsx, a
// "use client" module). Importing @/lib/supabase/server here — statically or
// via await import() — would pull next/headers into the client graph and
// break `npm run build`, and would close an import cycle
// (lib/supabase/server.ts already imports this file).
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The slug is sent as the `x-two42-org` header on every
 * Supabase client, so anonymous requests resolve an org via
 * app_request_org_id() (authenticated principals always win over the
 * header — it only ever selects among already-public content).
 *
 * The request host never names an org: a public per-org route passes its
 * own path slug to createClient(), and everything else gets this pin.
 */
export const DEFAULT_ORG_SLUG = "default";

/**
 * Slug for the org this request is about, sent as `x-two42-org`.
 *
 * The mapping is NOT hardcoded: `NEXT_PUBLIC_ORG_SLUG` overrides it, and the
 * override must be the slug of a real organization row — anonymous flows
 * (the join form, public content) resolve their org from this slug via
 * app_request_org_id(), so a slug that matches nothing makes those flows
 * fail closed rather than fall back to another org.
 */
export function resolveOrgSlug(): string {
  return process.env.NEXT_PUBLIC_ORG_SLUG || DEFAULT_ORG_SLUG;
}

/**
 * Mirrors the regex provision_organization() enforces on the DB side, so the
 * app can never route to a slug the DB would refuse to mint. `{1,62}` means
 * minimum TWO characters total — that is the DB's rule, not a typo.
 */
export const ORG_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function isValidOrgSlug(slug: string): boolean {
  return ORG_SLUG_PATTERN.test(slug);
}

/**
 * Mirrors the denylist provision_organization() enforces (TN006), so the
 * app can never route to — or offer — a slug the DB would refuse to mint.
 * Keep this list in sync with the array in
 * the TN006 migration (supabase/migrations/20260818000000_reserved_org_slugs.sql).
 *
 * 'default' is deliberately NOT here yet: it is the slug of the one org
 * that exists today (DEFAULT_ORG_SLUG above). Add it once that org is
 * renamed or retired.
 */
export const RESERVED_ORG_SLUGS: ReadonlySet<string> = new Set([
  "www", "app", "api", "admin", "platform", "auth", "mail", "email",
  "static", "assets", "cdn", "status", "docs", "blog", "help", "support",
  "dev", "staging", "preview", "test",
]);

export function isReservedOrgSlug(slug: string): boolean {
  return RESERVED_ORG_SLUGS.has(slug);
}

/**
 * The single normalization point for a request host. Lowercases, strips a
 * port, strips a trailing FQDN dot — port first, so "example.com.:443"
 * normalizes fully.
 */
export function normalizeHost(rawHost: string): string {
  return rawHost.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

/**
 * The app serves one canonical host: the `NEXT_PUBLIC_SITE_URL` host. True
 * for it and for the closed, static set a deployment is also legitimately
 * reached on — local dev and Vercel preview URLs. The host never names an
 * org, so this is a yes/no gate and nothing more; never widen it
 * dynamically. Takes an already-normalized host.
 */
export function isExpectedHost(
  host: string,
  opts: { siteUrl: string }
): boolean {
  if (host === "localhost" || host === "127.0.0.1") return true;
  if (host.endsWith(".vercel.app")) return true;
  try {
    const siteHost = normalizeHost(new URL(opts.siteUrl).host);
    if (siteHost && host === siteHost) return true;
  } catch (err) {
    // A malformed value on the deployment's own host 404s the entire site;
    // without this log that happens with zero operator signal.
    console.error(
      "isExpectedHost: malformed NEXT_PUBLIC_SITE_URL %s:",
      opts.siteUrl,
      err
    );
  }
  return false;
}

/**
 * The single implementation of the fail-closed
 * org-resolution guard both anonymous entry points (`/join`,
 * `/join/family/[token]`) and the per-org route (`/[orgSlug]/join`) rely on.
 * Resolves the request's org via app_request_org_id() — the same value the
 * access_requests RLS WITH CHECK evaluates — and returns NULL on either
 * failure mode (RPC error, or a slug matching no organization row), logging
 * both so the public funnel never goes down with zero operator signal.
 */
export async function resolveRequestOrgId(
  client: SupabaseClient,
  opts: { label: string; orgSlug: string }
): Promise<string | null> {
  // org-anchor: app_request_org_id() IS the org resolver — it derives the org
  // from the principal or the x-two42-org header, so there is no org_id to
  // pass in; callers scope everything after this on the value it returns
  const { data, error } = await client.rpc("app_request_org_id");
  // The generated type claims Returns: string, but the SQL function
  // returns NULL whenever neither a principal nor the header resolves.
  // This narrowing is the only thing catching that lying type — do not
  // replace it with a non-null assertion.
  const orgId = typeof data === "string" ? data : null;
  if (error) {
    console.error("%s: org resolution failed:", opts.label, error);
  } else if (!orgId) {
    // The RPC succeeded but returned NULL — the resolved slug matches no
    // organization row. `error` stays null in this path, so without this
    // log the public funnel goes down with zero operator signal.
    console.error(
      "%s: org resolution returned NULL for slug %s",
      opts.label,
      opts.orgSlug
    );
  }
  return orgId;
}
