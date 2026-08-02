// Type-only import — erased at compile time. resolveRequestOrgId() takes the
// client as a PARAMETER, never constructs one: this module is reachable from
// the client bundle (lib/supabase/client.ts → app/join/JoinForm.tsx, a
// "use client" module). Importing @/lib/supabase/server here — statically or
// via await import() — would pull next/headers into the client graph and
// break `npm run build`, and would close an import cycle
// (lib/supabase/server.ts already imports this file).
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Phase 2 (CWA-9 / #211): slug sent as the `x-two42-org` header on every
 * Supabase client, so anonymous requests resolve an org via
 * app_request_org_id() (authenticated principals always win over the
 * header — it only ever selects among already-public content).
 *
 * Single-tenant interim: every host maps to the one deployed org. Phase 5
 * (custom domains, #214) replaces this with real host → org resolution.
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
 *
 * Takes no host parameter: Phase 5 (custom domains, #214) will reintroduce
 * one together with the resolution logic that actually reads it. Carrying an
 * unread parameter until then bought nothing.
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
 * Phase 4b (CWA-48 / #314): the single implementation of the fail-closed
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
