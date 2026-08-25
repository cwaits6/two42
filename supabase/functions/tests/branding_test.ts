// Locks the injection boundary of _shared/branding.ts (CWA-56): the accent
// hex gate (CSS injection), the display_name control-character strip and
// RFC 5322 quoting (header injection), and the reply_to address gate. These
// mirror lib/branding.ts + lib/email/identity.ts — a change on either side
// must be made on both. Pure units: no network, no database, no env.
//
// Assertions are on EXACT output strings, never substring checks — a
// substring check would pass on output that still carries an injected CRLF.

import { assertEquals } from "jsr:@std/assert@1";
import {
  formatFromHeader,
  parseAddress,
  resolveEmailBranding,
  type BrandingDefaults,
} from "../_shared/branding.ts";

const PLATFORM = "noreply@two42.example";
const DEFAULTS: BrandingDefaults = {
  displayName: "two42",
  accent: "#B85C38",
  platformAddress: PLATFORM,
};
const FALLBACK = {
  orgName: "two42",
  replyTo: null,
  accent: "#B85C38",
  fromAddress: PLATFORM,
};

// ── resolveEmailBranding: whole-value fallback ───────────────────────────────

Deno.test("resolveEmailBranding falls back entirely for non-object values", () => {
  assertEquals(resolveEmailBranding(null, DEFAULTS), FALLBACK);
  assertEquals(resolveEmailBranding(undefined, DEFAULTS), FALLBACK);
  assertEquals(resolveEmailBranding([], DEFAULTS), FALLBACK);
  assertEquals(resolveEmailBranding("string", DEFAULTS), FALLBACK);
  assertEquals(resolveEmailBranding(42, DEFAULTS), FALLBACK);
});

Deno.test("resolveEmailBranding falls back per-key for an empty object", () => {
  assertEquals(resolveEmailBranding({}, DEFAULTS), FALLBACK);
});

// ── resolveEmailBranding: per-key fallback ───────────────────────────────────

Deno.test("an invalid accent does not discard a valid display_name", () => {
  assertEquals(
    resolveEmailBranding({ display_name: "Grace Fellowship", accent: "red" }, DEFAULTS),
    { orgName: "Grace Fellowship", replyTo: null, accent: "#B85C38", fromAddress: PLATFORM },
  );
});

// ── accent: the CSS-injection gate ───────────────────────────────────────────

Deno.test("accent accepts a strict 6-digit hex in either case", () => {
  assertEquals(resolveEmailBranding({ accent: "#2E6F5E" }, DEFAULTS).accent, "#2E6F5E");
  assertEquals(resolveEmailBranding({ accent: "#b85c38" }, DEFAULTS).accent, "#b85c38");
});

Deno.test("accent rejects everything that is not a bare 6-digit hex", () => {
  for (
    const bad of [
      "red",
      "#FFF",
      "#GGGGGG",
      "#B85C38; background:url(x)",
      "#B85C38 !important",
    ]
  ) {
    assertEquals(resolveEmailBranding({ accent: bad }, DEFAULTS).accent, "#B85C38");
  }
});

// ── display_name: the header-injection strip ─────────────────────────────────

Deno.test("display_name strips C0/C1 control characters", () => {
  assertEquals(
    resolveEmailBranding(
      { display_name: "Grace\r\nBcc: evil@evil.example\u0000 Fellowship\u009F" },
      DEFAULTS,
    ).orgName,
    "GraceBcc: evil@evil.example Fellowship",
  );
});

Deno.test("display_name that is empty or whitespace-only after stripping falls back", () => {
  assertEquals(resolveEmailBranding({ display_name: "" }, DEFAULTS).orgName, "two42");
  assertEquals(resolveEmailBranding({ display_name: "   " }, DEFAULTS).orgName, "two42");
  assertEquals(
    resolveEmailBranding({ display_name: "\r\n\u0000" }, DEFAULTS).orgName,
    "two42",
  );
});

// ── reply_to: the address gate ───────────────────────────────────────────────

Deno.test("reply_to keeps a valid address", () => {
  assertEquals(
    resolveEmailBranding({ reply_to: "office@gracefellowship.org" }, DEFAULTS).replyTo,
    "office@gracefellowship.org",
  );
});

Deno.test("reply_to rejects malformed or oversized addresses", () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const overlong = `${"a".repeat(250)}@b.cd`; // 255 chars — over the 254 cap
    for (
      const bad of [
        overlong,
        "a@b",
        "a b@c.d",
        "x@y.z\r\nBcc: v@w.x",
      ]
    ) {
      assertEquals(resolveEmailBranding({ reply_to: bad }, DEFAULTS).replyTo, null);
    }
  } finally {
    console.warn = originalWarn;
  }
});

// ── fromAddress: the SENDING_DOMAIN + verified-status gate (CWA-71) ──────────

Deno.test("fromAddress uses noreply@<domain> for a verified row with a valid domain", () => {
  assertEquals(
    resolveEmailBranding({}, DEFAULTS, "a", { domain: "grace.church", status: "verified" })
      .fromAddress,
    "noreply@grace.church",
  );
});

Deno.test("fromAddress falls back independently of the branding fallback", () => {
  // A non-object branding row falls back entirely — but a verified domain
  // still substitutes, and vice versa a bad domain must not discard a valid
  // display_name.
  assertEquals(
    resolveEmailBranding(null, DEFAULTS, "a", { domain: "grace.church", status: "verified" }),
    { orgName: "two42", replyTo: null, accent: "#B85C38", fromAddress: "noreply@grace.church" },
  );
});

Deno.test("fromAddress rejects invalid domain shapes even on a verified row", () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    for (
      const bad of [
        "Grace.Church", // uppercase — no normalization at send time
        "-grace.church", // leading hyphen in a label
        "grace-.church", // trailing hyphen in a label
        "grace.church.", // trailing dot
        "grace_hub.church", // underscore
        "grâce.church", // non-ASCII, no IDNA mapping attempted
        "church", // no dot
        "a.b", // under the 4-char floor
        `${`${"a".repeat(63)}.`.repeat(4)}com`, // over the 253-char cap
        "grace.church@evil.com", // @ — defense in depth
        "grace.church>", // angle bracket — defense in depth
        "grace .church", // whitespace — defense in depth
        "grace.church\r\nBcc: v@w.x", // CR/LF — defense in depth
      ]
    ) {
      assertEquals(
        resolveEmailBranding({}, DEFAULTS, "a", { domain: bad, status: "verified" })
          .fromAddress,
        PLATFORM,
        `domain ${JSON.stringify(bad)} must be rejected`,
      );
    }
  } finally {
    console.error = originalError;
  }
});

Deno.test("fromAddress falls back for every non-verified status", () => {
  // Several distinct statuses, not just one: the gate is equality to
  // 'verified', so any future addition to the status vocabulary must land on
  // the fallback side of this same test shape.
  for (
    const status of ["not_started", "pending", "failure", "temporary_failure", "failed"]
  ) {
    assertEquals(
      resolveEmailBranding({}, DEFAULTS, "a", { domain: "grace.church", status }).fromAddress,
      PLATFORM,
      `status ${status} must not substitute`,
    );
  }
});

Deno.test("fromAddress falls back when the org has no domain row", () => {
  // undefined is the call shape both reminder entry points produce for an
  // org with an empty org_email_domains embed (org.org_email_domains[0] ?? null).
  assertEquals(resolveEmailBranding({}, DEFAULTS, "a").fromAddress, PLATFORM);
  assertEquals(resolveEmailBranding({}, DEFAULTS, "a", null).fromAddress, PLATFORM);
});

// ── formatFromHeader: RFC 5322 quoting ───────────────────────────────────────

Deno.test("formatFromHeader emits plain-subset names unquoted", () => {
  assertEquals(
    formatFromHeader("Grace Fellowship", "noreply@x.org"),
    "Grace Fellowship <noreply@x.org>",
  );
  // `.` is in the plain set even though RFC 5322 lists it under specials.
  assertEquals(formatFromHeader("Dr. Smith", "noreply@x.org"), "Dr. Smith <noreply@x.org>");
});

Deno.test("formatFromHeader quotes names outside the plain subset", () => {
  assertEquals(
    formatFromHeader("Grace & Peace", "noreply@x.org"),
    '"Grace & Peace" <noreply@x.org>',
  );
});

Deno.test("formatFromHeader escapes backslashes and quotes in quoted names", () => {
  assertEquals(
    formatFromHeader('Say "hi" \\ team', "noreply@x.org"),
    '"Say \\"hi\\" \\\\ team" <noreply@x.org>',
  );
});

Deno.test("formatFromHeader strips CR/LF unconditionally", () => {
  assertEquals(
    formatFromHeader("Evil\r\nBcc: v@w.x", "noreply@x.org"),
    '"EvilBcc: v@w.x" <noreply@x.org>',
  );
});

Deno.test("formatFromHeader returns the bare address for an empty name", () => {
  assertEquals(formatFromHeader("", "noreply@x.org"), "noreply@x.org");
  assertEquals(formatFromHeader("  \r\n ", "noreply@x.org"), "noreply@x.org");
});

// ── parseAddress ─────────────────────────────────────────────────────────────

Deno.test("parseAddress extracts the address from a display-name form", () => {
  assertEquals(parseAddress("two42 <noreply@x.org>"), "noreply@x.org");
});

Deno.test("parseAddress passes a bare address through", () => {
  assertEquals(parseAddress("noreply@x.org"), "noreply@x.org");
});
