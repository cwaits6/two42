// Per-org email branding for the cron Edge Functions (CWA-56).
//
// A DELIBERATE MIRROR of lib/branding.ts + lib/email/identity.ts. Edge
// functions cannot import from lib/ (Next.js "@/" path aliases, react's
// cache(), npm module resolution), so the validation logic is duplicated
// here. The regexes below are an injection boundary, not style choices:
// organizations.branding is admin-supplied free text that lands in inline
// CSS and RFC 5322 headers. Any change to this logic must be made on both
// sides — grep for this filename when touching lib/branding.ts or
// lib/email/identity.ts, and vice versa.
//
// Differences from the app version (all deliberate):
//   - No logo_url and no accentLight — cron mail renders neither.
//   - Defaults are passed in by the caller (the env-derived APP_NAME /
//     BRAND_COLOR, the non-prefixed twins of NEXT_PUBLIC_APP_NAME /
//     NEXT_PUBLIC_COLOR_PRIMARY with the same "two42" / "#B85C38"
//     fallbacks) rather than imported from siteConfig.
//   - No DB read here — `raw` arrives from the listActiveOrgs row, so this
//     module stays supabase-js-free and offline-testable, matching the
//     stated design of _shared/orgs.ts.

/** What the reminder mail builders need from an org's branding row. */
export interface EmailBranding {
  orgName: string;
  replyTo: string | null;
  accent: string;
  // The resolved From: address: `noreply@<domain>` when the org holds a
  // verified org_email_domains row whose domain passes SENDING_DOMAIN,
  // the platform address in every other case. The local part is a fixed
  // constant — never admin-choosable.
  fromAddress: string;
}

/** Env-derived fallbacks, resolved once by the entry point. */
export interface BrandingDefaults {
  displayName: string; // APP_NAME env
  accent: string; // BRAND_COLOR env
  platformAddress: string; // parseAddress(EMAIL_FROM env)
}

// accent is interpolated into the inline style="" attributes of both
// reminder emails with no per-sink escaping. This strict hex shape is the
// CSS-injection guard for all of them. Do not relax it.
const HEX = /^#[0-9a-fA-F]{6}$/;

// display_name reaches RFC 5322 headers (From:) via formatFromHeader below;
// strip C0/C1 control characters at this boundary so no sink has to.
// formatFromHeader() keeps its own CR/LF strip as defence-in-depth.
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;

// reply_to becomes an RFC 5322 Reply-To header via the Resend API, which
// rejects malformed addresses. Deliberately conservative: over-rejecting
// yields no Reply-To header, which is the pre-branding behavior and
// strictly better than a failed send.
const EMAIL = /^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/;

// The org sending-domain gate (Phase 5 §10.3, CWA-71). A validation boundary
// with the same standing as PLAIN_NAME, not a style choice: the domain is
// admin-supplied text on the address side of the `<…>` in From:, which
// PLAIN_NAME and formatFromHeader()'s CR/LF strip do not cover. Same grammar
// as the org_email_domains_domain_shape CHECK and the claim-time
// DOMAIN_SHAPE in app/api/admin/email-domain/route.ts: lowercase LDH labels
// (1–63 chars each, no leading/trailing hyphen), at least one dot, 4–253
// chars total — rejecting underscores, trailing dots, ports, whitespace,
// CR/LF, `@`, `<`/`>`, and any non-ASCII byte by construction. It performs
// no normalization: a non-canonical value fails and the platform address is
// used, never a "cleaned-up" version. It runs at SEND time on the value read
// back from the DB — the write path already validates; this is what makes a
// compromised or hand-edited row non-exploitable. Mirrored byte-for-byte
// from lib/email/identity.ts; a change lands on both sides.
const SENDING_DOMAIN =
  /^(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

// Names of only these characters are emitted unquoted. Deliberately narrower
// than RFC 5322 permits — and note `.` is NOT atext (RFC 5322 §3.2.3 lists it
// under specials; an unquoted "Dr. Smith" is legal only via the obsolete
// obs-phrase production, which every mainstream MTA still accepts).
// Everything outside this set takes the quoted-string branch below, which is
// always safe. Widening this set is never necessary; do not.
const PLAIN_NAME = /^[A-Za-z0-9 ._-]+$/;

/**
 * RFC 5322 §3.4 From: header. Org display names are admin-supplied free
 * text: names outside the plain subset become a quoted-string with `\` and
 * `"` escaped, and CR/LF is stripped unconditionally (header injection).
 */
export function formatFromHeader(displayName: string, address: string): string {
  const name = displayName.replace(/[\r\n]/g, "").trim();
  if (name === "") return address;
  if (PLAIN_NAME.test(name)) return `${name} <${address}>`;
  return `"${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}" <${address}>`;
}

/** The bare address out of `two42 <noreply@example.org>` (or a bare addr). */
export function parseAddress(from: string): string {
  const match = from.match(/<([^<>]+)>\s*$/);
  return (match ? match[1] : from).trim();
}

/**
 * The verified-status gate on the per-org From: address (mirrors
 * lib/email/identity.ts, which bakes in PLATFORM_ADDRESS where this module
 * takes the caller's env-derived platformAddress). Gated on equality to
 * 'verified' — never an enumerated list of fallback statuses; the status
 * vocabulary has already grown once and will again.
 */
function resolveFromAddress(
  domain: string | null | undefined,
  status: string | null | undefined,
  platformAddress: string,
): string {
  if (status !== "verified" || !domain) return platformAddress;
  if (!SENDING_DOMAIN.test(domain)) {
    console.error(
      "resolveEmailBranding: verified sending domain failed SENDING_DOMAIN, falling back to platform address:",
      domain,
    );
    return platformAddress;
  }
  return `noreply@${domain}`;
}

/**
 * Merge a raw branding jsonb value onto the env defaults. Falls back
 * per-key — an invalid accent must not discard a valid display_name. A
 * non-object (array, scalar, null) falls back entirely.
 *
 * `emailDomain` is the org's org_email_domains row, ridden along on the
 * listActiveOrgs query (like `raw`, it arrives as a plain parameter — no DB
 * read here). It only affects fromAddress, which falls back independently:
 * a bad domain row must not discard a valid display_name, and vice versa.
 *
 * Total by contract: this must never throw, so a malformed branding row
 * degrades to the platform defaults instead of becoming an org-level
 * failure (mirroring lib/email/identity.ts's fail-soft contract).
 */
export function resolveEmailBranding(
  raw: unknown,
  defaults: BrandingDefaults,
  orgSlug?: string,
  emailDomain?: { domain: string; status: string } | null,
): EmailBranding {
  const fromAddress = resolveFromAddress(
    emailDomain?.domain,
    emailDomain?.status,
    defaults.platformAddress,
  );
  const fallback: EmailBranding = {
    orgName: defaults.displayName,
    replyTo: null,
    accent: defaults.accent,
    fromAddress,
  };
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fallback;
  }
  const b = raw as Record<string, unknown>;
  const name =
    typeof b.display_name === "string" ? b.display_name.replace(CONTROL, "").trim() : "";
  const replyTo = typeof b.reply_to === "string" ? b.reply_to.trim() : null;
  const replyToValid = replyTo !== null && replyTo.length <= 254 && EMAIL.test(replyTo);
  if (replyTo !== null && replyTo !== "" && !replyToValid) {
    // The one silent fallback worth a signal: a dropped Reply-To is far more
    // surprising than a dropped color, and the cause (a branding column) is
    // nowhere near the symptom (mail replying to noreply@).
    console.warn(
      "[org %s] Ignoring malformed branding.reply_to; sending without a Reply-To header",
      orgSlug ?? "unknown",
    );
  }
  return {
    orgName: name !== "" ? name : defaults.displayName,
    replyTo: replyToValid ? replyTo : null,
    accent:
      typeof b.accent === "string" && HEX.test(b.accent) ? b.accent : defaults.accent,
    fromAddress,
  };
}
