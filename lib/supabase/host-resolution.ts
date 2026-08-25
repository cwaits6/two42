import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import { classifyHost, isTrustedFallbackHost, normalizeHost } from "@/lib/org";

/**
 * Calls the already-granted app_org_slug_for_host() (Phase 5 PR 2,
 * 20260824000000_org_domains.sql) through a bare anon/publishable-key
 * client — no cookies needed, it's a pure function of the host
 * (docs/plans/phase-5-domains-email.md §5.1). NOT a service-role client:
 * scripts/check-service-role-org-scope.mjs only scans the service-role
 * client factory's call sites, so this call site is correctly outside its
 * scope. (Its inventory-sync check is a plain text scan, so even naming
 * that factory's binding name here would falsely flag this file — say
 * "service-role client factory" instead if this comment is edited again.)
 */
export async function lookupCustomDomainViaRpc(
  host: string
): Promise<string | null> {
  const supabase = createSupabaseJsClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
  const { data, error } = await supabase.rpc("app_org_slug_for_host", {
    _host: host,
  });
  if (error) {
    console.error(
      "Host resolution: app_org_slug_for_host failed for host %s:",
      host,
      error
    );
    return null;
  }
  return typeof data === "string" && data.length > 0 ? data : null;
}

/**
 * A DB round trip per request in middleware is real latency on every
 * page (§5.2 "Caching"). Best-effort, per-instance, module-scope cache —
 * NOT a correctness mechanism: nothing may depend on it being fresh, and
 * a domain that has just been verified may take up to the TTL to route.
 * Negative results are cached too (shorter TTL), or an unknown-host flood
 * becomes a query flood. Returns a factory so tests get an isolated cache
 * instead of sharing middleware's module-scope singleton.
 */
export function createHostResolutionCache(opts?: {
  maxEntries?: number;
  positiveTtlMs?: number;
  negativeTtlMs?: number;
}) {
  const maxEntries = opts?.maxEntries ?? 256;
  const positiveTtlMs = opts?.positiveTtlMs ?? 60_000;
  const negativeTtlMs = opts?.negativeTtlMs ?? 10_000;
  const cache = new Map<string, { slug: string | null; expiresAt: number }>();

  return async function lookupCustomDomainCached(
    host: string,
    lookup: (host: string) => Promise<string | null>
  ): Promise<string | null> {
    const now = Date.now();
    const hit = cache.get(host);
    if (hit && hit.expiresAt > now) return hit.slug;

    const slug = await lookup(host);

    if (!cache.has(host) && cache.size >= maxEntries) {
      // Map preserves insertion order — evict the oldest entry. Best-
      // effort bound, not a real LRU; see the comment above.
      const oldestKey = cache.keys().next().value;
      if (oldestKey !== undefined) cache.delete(oldestKey);
    }
    cache.set(host, {
      slug,
      expiresAt: now + (slug ? positiveTtlMs : negativeTtlMs),
    });
    return slug;
  };
}

export interface HostResolutionResult {
  /** Slug to send as x-two42-org. Null only when the request should 404. */
  orgSlug: string | null;
  /** True only when the HOST ITSELF named an org (subdomain or verified
   *  custom domain) — false on the trusted-host env-pin fallback. Callers
   *  use this to decide whether to set x-two42-resolved-org at all. */
  hostResolvedOrg: boolean;
}

/**
 * Phase 5 PR 3 (CWA-67 / #360), §5.2 steps 2-4. `lookupCustomDomain` is
 * injected so this stays unit-testable without mocking Supabase or the
 * cache — pass lookupCustomDomainViaRpc (optionally wrapped by
 * createHostResolutionCache()) in production, a stub in tests.
 */
export async function resolveHostToOrg(
  rawHost: string,
  opts: {
    apex: string;
    siteUrl: string;
    envSlug: string;
    lookupCustomDomain: (host: string) => Promise<string | null>;
  }
): Promise<HostResolutionResult> {
  const host = normalizeHost(rawHost);
  const classification = classifyHost(host, opts.apex);

  let slug: string | null = null;
  if (classification.kind === "subdomain") {
    slug = classification.slug;
  } else if (classification.kind === "custom-domain-candidate") {
    slug = await opts.lookupCustomDomain(host);
  }
  // "apex" and "invalid-subdomain" leave slug null — never fall through
  // to the custom-domain lookup for either (§5.2 step 2).

  if (slug) {
    return { orgSlug: slug, hostResolvedOrg: true };
  }
  if (isTrustedFallbackHost(host, { siteUrl: opts.siteUrl })) {
    return { orgSlug: opts.envSlug, hostResolvedOrg: false };
  }
  return { orgSlug: null, hostResolvedOrg: false };
}
