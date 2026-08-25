export const DEFAULT_NEXT = "/dashboard";

/**
 * Open-redirect hardening for the auth callback's `next` param (Phase 5 PR
 * 3, CWA-67 / #360 §8) — same sentinel-origin technique as
 * app/(auth)/login/page.tsx's `redirect` param. `new URL(raw, "http://_")`
 * makes any absolute URL or scheme ("javascript:...", "https://evil.com")
 * resolve to a DIFFERENT origin than the "http://_" sentinel, so the origin
 * check alone rejects both. The explicit "//" check is defense-in-depth on
 * top of that — under WHATWG URL parsing every protocol-relative input it
 * would catch is already rejected by the origin check alone, but it's kept
 * as a second, independent guard against a same-origin-looking path with an
 * unexpected leading "//" pathname; do not treat the origin check as
 * optional on the assumption this line covers it.
 *
 * Lives beside route.ts rather than in it: Next.js validates that a route
 * file exports only handler fields, so a helper export there fails the
 * build's type check.
 */
export function sanitizeNext(raw: string | null): string {
  if (!raw) return DEFAULT_NEXT;
  try {
    const url = new URL(raw, "http://_");
    if (
      url.origin === "http://_" &&
      url.pathname.startsWith("/") &&
      !url.pathname.startsWith("//")
    ) {
      return url.pathname + url.search + url.hash;
    }
  } catch {
    // malformed `next` — fall back to default
  }
  return DEFAULT_NEXT;
}
