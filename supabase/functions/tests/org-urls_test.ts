// Locks the per-org link-origin rule of _shared/org-urls.ts. The cases
// mirror lib/org-urls.test.ts one-for-one — the two computeOrgOrigin()
// implementations must produce byte-identical URLs for the same inputs, and
// a change on either side must be made on both. Pure units: no network, no
// database, no env.

import { assertEquals } from "jsr:@std/assert@1";
import { computeOrgOrigin, type OrgDomainRow } from "../_shared/org-urls.ts";

const APEX = "two42.example";
const PLATFORM_URL = "https://platform.two42.example";
const SUBDOMAIN = `https://grace.${APEX}`;

function origin(slug: string | null | undefined, domains: OrgDomainRow[] | null | undefined): string {
  return computeOrgOrigin(slug, domains, APEX, PLATFORM_URL);
}

function silenced<T>(fn: () => T): T {
  const originalError = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = originalError;
  }
}

Deno.test("computeOrgOrigin uses the custom domain when its row is verified AND attached", () => {
  assertEquals(
    origin("grace", [
      { domain: "grace.church", status: "verified", attached_at: "2026-09-01T00:00:00Z" },
    ]),
    "https://grace.church",
  );
});

Deno.test("computeOrgOrigin falls through for a verified row that is not attached", () => {
  // verified proves ownership, not routing — until the attachment worker
  // stamps attached_at the host does not route anywhere.
  assertEquals(
    origin("grace", [{ domain: "grace.church", status: "verified", attached_at: null }]),
    SUBDOMAIN,
  );
});

Deno.test("computeOrgOrigin never trusts attached_at alone", () => {
  for (const status of ["pending", "failed", "removing"]) {
    assertEquals(
      origin("grace", [
        { domain: "grace.church", status, attached_at: "2026-09-01T00:00:00Z" },
      ]),
      SUBDOMAIN,
      `status ${status} must not become the origin`,
    );
  }
});

Deno.test("computeOrgOrigin picks the attached row over a pending claim", () => {
  assertEquals(
    origin("grace", [
      { domain: "new.church", status: "pending", attached_at: null },
      { domain: "grace.church", status: "verified", attached_at: "2026-09-01T00:00:00Z" },
    ]),
    "https://grace.church",
  );
});

Deno.test("computeOrgOrigin picks the earliest-attached row deterministically", () => {
  const rows: OrgDomainRow[] = [
    { domain: "later.church", status: "verified", attached_at: "2026-09-02T00:00:00Z" },
    { domain: "earlier.church", status: "verified", attached_at: "2026-09-01T00:00:00Z" },
  ];
  assertEquals(origin("grace", rows), "https://earlier.church");
  assertEquals(origin("grace", [...rows].reverse()), "https://earlier.church");
});

Deno.test("computeOrgOrigin breaks an equal attached_at tie by domain regardless of row order", () => {
  const rows: OrgDomainRow[] = [
    { domain: "zeta.church", status: "verified", attached_at: "2026-09-01T00:00:00Z" },
    { domain: "alpha.church", status: "verified", attached_at: "2026-09-01T00:00:00Z" },
  ];
  assertEquals(origin("grace", rows), "https://alpha.church");
  assertEquals(origin("grace", [...rows].reverse()), "https://alpha.church");
});

Deno.test("computeOrgOrigin falls through when an attached domain fails ORG_DOMAIN_SHAPE", () => {
  const invalid = [
    "Grace.Church", // uppercase — no normalization at use time
    "-grace.church", // leading hyphen in a label
    "grace-.church", // trailing hyphen in a label
    "grace.church.", // trailing dot
    "grace_hub.church", // underscore
    "grâce.church", // non-ASCII, no IDNA mapping attempted
    "church", // no dot
    "a.b", // under the 4-char floor
    `${`${"a".repeat(63)}.`.repeat(4)}com`, // over the 253-char cap
    "grace.church:8443", // port
    "grace.church/evil", // path — would not survive `https://${domain}`
    "grace .church", // whitespace
    "grace.church\r\nBcc: v@w.x", // CR/LF
  ];
  for (const domain of invalid) {
    assertEquals(
      silenced(() =>
        origin("grace", [{ domain, status: "verified", attached_at: "2026-09-01T00:00:00Z" }])
      ),
      SUBDOMAIN,
      `domain ${JSON.stringify(domain)} must be rejected`,
    );
  }
});

Deno.test("computeOrgOrigin uses the wildcard subdomain when the org has no domains", () => {
  assertEquals(origin("grace", []), SUBDOMAIN);
  assertEquals(origin("grace", null), SUBDOMAIN);
  assertEquals(origin("grace", undefined), SUBDOMAIN);
});

Deno.test("computeOrgOrigin uses the platform URL when there is no slug either", () => {
  assertEquals(origin(null, []), PLATFORM_URL);
  assertEquals(origin(undefined, []), PLATFORM_URL);
  assertEquals(origin("", []), PLATFORM_URL);
});
