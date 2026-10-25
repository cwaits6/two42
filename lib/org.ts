// Type-only import — erased at compile time. resolveRequestOrgId() takes the
// client as a PARAMETER, never constructs one: this module is reachable from
// the client bundle (lib/uploadImage.ts, a browser module). Importing
// @/lib/supabase/server here — statically or via await import() — would pull
// next/headers into the client graph and break `npm run build`.
import type { SupabaseClient } from "@supabase/supabase-js";

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
 * The single fail-closed org-resolution guard for callers that hold a
 * session but no org id of their own. Resolves the request's org via
 * app_request_org_id() — the same value every RLS WITH CHECK evaluates —
 * and returns NULL on either failure mode (RPC error, or an anonymous
 * request, which resolves no org), logging both so a broken upload or
 * email path never goes down with zero operator signal.
 */
export async function resolveRequestOrgId(
  client: SupabaseClient,
  opts: { label: string }
): Promise<string | null> {
  // org-anchor: app_request_org_id() IS the org resolver — it derives the org
  // from the principal, so there is no org_id to pass in; callers scope
  // everything after this on the value it returns
  const { data, error } = await client.rpc("app_request_org_id");
  // The generated type claims Returns: string, but the SQL function
  // returns NULL whenever there is no principal. This narrowing is the only
  // thing catching that lying type — do not replace it with a non-null
  // assertion.
  const orgId = typeof data === "string" ? data : null;
  if (error) {
    console.error("%s: org resolution failed:", opts.label, error);
  } else if (!orgId) {
    // The RPC succeeded but returned NULL — no principal. `error` stays null
    // in this path, so without this log the failure is invisible.
    console.error("%s: org resolution returned NULL", opts.label);
  }
  return orgId;
}
