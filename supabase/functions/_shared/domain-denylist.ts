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

function canonical(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}
