// The attachment worker's apex denylist: refuses the platform apex and any
// subdomain of it, so no tenant can attach a name that shadows the platform.
//
// Deno mirror of the apex/subdomain half of classifyHost() in lib/org.ts —
// edge functions cannot import from lib/, the same reason _shared/branding.ts
// mirrors lib/branding.ts. lib/org.ts is the source of truth; a change to
// the label-boundary rule lands on both sides. Org-slug validation is
// deliberately not mirrored: a Vercel-bound custom domain is never an org
// slug, and the worker only needs the "is this the platform's namespace?"
// answer.
//
// The claim route reuses classifyHost() directly as a UX check. This is the
// real boundary: the worker holds the Vercel token, the app does not.

/**
 * True when `host` is the platform apex itself or any subdomain of it.
 * Exact label boundary — `host === apex` or `host.endsWith("." + apex)` —
 * never a raw suffix check, so a registrable name that merely ends with the
 * apex string ("evil-two42.io") is NOT denylisted. Both sides are lowercased
 * and trimmed of a trailing FQDN dot first; a stored org_domains.domain is
 * already canonical, but the apex comes from an env var.
 */
export function isPlatformApexOrSubdomain(host: string, apex: string): boolean {
  const h = canonical(host);
  const a = canonical(apex);
  if (h === "" || a === "") return false;
  return h === a || h.endsWith(`.${a}`);
}

/** The apex the worker refuses when PLATFORM_APEX is unset. */
export const DEFAULT_PLATFORM_APEX = "two42.io";

/**
 * Resolve the PLATFORM_APEX secret at startup. Unset or empty means the
 * default; a value that is only whitespace is a misconfiguration and throws,
 * because canonical() would trim it to "" and isPlatformApexOrSubdomain()
 * would then refuse nothing — silently letting a tenant attach a name inside
 * the platform's own namespace.
 */
export function resolvePlatformApex(
  raw: string | undefined,
  fallback: string = DEFAULT_PLATFORM_APEX,
): string {
  if (raw === undefined || raw === "") return fallback;
  const apex = canonical(raw);
  if (apex === "") {
    throw new Error(
      "PLATFORM_APEX is set but blank; unset it to use the default or set it to the platform apex",
    );
  }
  return apex;
}

function canonical(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}
