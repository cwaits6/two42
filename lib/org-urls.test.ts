// Unit tests for the per-org link origin. computeOrgOrigin is a pure unit;
// orgBaseUrl runs against a stubbed service client — no network, no
// database, no request context.

import { beforeEach, describe, expect, it, vi } from "vitest";

const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => {
    throw new Error("orgBaseUrl must not touch the request client");
  },
  createServiceClient: () => createServiceClient(),
}));

const { computeOrgOrigin, orgBaseUrl } = await import("@/lib/org-urls");
const { siteConfig } = await import("@/lib/config");

const ORG_ID = "11111111-2222-3333-4444-555555555555";
const SUBDOMAIN = `https://grace.${siteConfig.platformApex}`;

beforeEach(() => {
  createServiceClient.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("computeOrgOrigin", () => {
  it("uses the custom domain when its row is verified AND attached", () => {
    expect(
      computeOrgOrigin("grace", [
        { domain: "grace.church", status: "verified", attached_at: "2026-09-01T00:00:00Z" },
      ]),
    ).toBe("https://grace.church");
  });

  it("falls through to the subdomain for a verified row that is not attached", () => {
    // verified proves ownership, not routing. This is the state every org
    // with a claimed domain is in until the attachment worker stamps
    // attached_at — getting it backwards would mail links to a host that
    // does not route anywhere.
    expect(
      computeOrgOrigin("grace", [
        { domain: "grace.church", status: "verified", attached_at: null },
      ]),
    ).toBe(SUBDOMAIN);
  });

  it("never trusts attached_at alone — every non-verified status falls through", () => {
    for (const status of ["pending", "failed", "removing"]) {
      expect(
        computeOrgOrigin("grace", [
          { domain: "grace.church", status, attached_at: "2026-09-01T00:00:00Z" },
        ]),
        `status ${status} must not become the origin`,
      ).toBe(SUBDOMAIN);
    }
  });

  it("picks the attached row when the org also has a pending claim", () => {
    expect(
      computeOrgOrigin("grace", [
        { domain: "new.church", status: "pending", attached_at: null },
        { domain: "grace.church", status: "verified", attached_at: "2026-09-01T00:00:00Z" },
      ]),
    ).toBe("https://grace.church");
  });

  it("picks the earliest-attached row deterministically when two are attached", () => {
    const rows = [
      { domain: "later.church", status: "verified", attached_at: "2026-09-02T00:00:00Z" },
      { domain: "earlier.church", status: "verified", attached_at: "2026-09-01T00:00:00Z" },
    ];
    expect(computeOrgOrigin("grace", rows)).toBe("https://earlier.church");
    expect(computeOrgOrigin("grace", [...rows].reverse())).toBe("https://earlier.church");
  });

  it("breaks an equal attached_at tie by domain so row order never changes the host", () => {
    const rows = [
      { domain: "zeta.church", status: "verified", attached_at: "2026-09-01T00:00:00Z" },
      { domain: "alpha.church", status: "verified", attached_at: "2026-09-01T00:00:00Z" },
    ];
    expect(computeOrgOrigin("grace", rows)).toBe("https://alpha.church");
    expect(computeOrgOrigin("grace", [...rows].reverse())).toBe("https://alpha.church");
  });

  it("falls through and logs when an attached domain fails ORG_DOMAIN_SHAPE", () => {
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
      expect(
        computeOrgOrigin("grace", [{ domain, status: "verified", attached_at: "2026-09-01T00:00:00Z" }]),
        `domain ${JSON.stringify(domain)} must be rejected`,
      ).toBe(SUBDOMAIN);
    }
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("failed ORG_DOMAIN_SHAPE"),
      "grace",
      expect.anything(),
    );
  });

  it("uses the wildcard subdomain when the org has no domains", () => {
    expect(computeOrgOrigin("grace", [])).toBe(SUBDOMAIN);
    expect(computeOrgOrigin("grace", null)).toBe(SUBDOMAIN);
    expect(computeOrgOrigin("grace", undefined)).toBe(SUBDOMAIN);
  });

  it("uses siteConfig.url when there is no slug either", () => {
    expect(computeOrgOrigin(null, [])).toBe(siteConfig.url);
    expect(computeOrgOrigin(undefined, [])).toBe(siteConfig.url);
    expect(computeOrgOrigin("", [])).toBe(siteConfig.url);
  });
});

// ── orgBaseUrl: the service-role read ───────────────────────────────────────

interface ServiceStub {
  org?: { slug: string; org_domains: Array<{ domain: string; status: string; attached_at: string | null }> } | null;
  orgError?: { message: string } | null;
}

/** Records every eq() so tests can assert the tenant filter was applied. */
function stubServiceClient(opts: ServiceStub) {
  const filters: Array<{ table: string; column: string; value: unknown }> = [];
  const client = {
    from(table: string) {
      return {
        select() {
          return this;
        },
        eq(column: string, value: unknown) {
          filters.push({ table, column, value });
          return this;
        },
        maybeSingle: async () => ({ data: opts.org ?? null, error: opts.orgError ?? null }),
      };
    },
  };
  createServiceClient.mockResolvedValue(client);
  return { filters };
}

describe("orgBaseUrl", () => {
  it("returns the custom origin and filters organizations by id", async () => {
    const { filters } = stubServiceClient({
      org: {
        slug: "grace",
        org_domains: [
          { domain: "grace.church", status: "verified", attached_at: "2026-09-01T00:00:00Z" },
        ],
      },
    });
    expect(await orgBaseUrl(ORG_ID)).toBe("https://grace.church");
    // The only tenant boundary on a service-role client.
    expect(filters).toEqual([{ table: "organizations", column: "id", value: ORG_ID }]);
  });

  it("returns the subdomain for an org with no attached domain", async () => {
    stubServiceClient({ org: { slug: "grace", org_domains: [] } });
    expect(await orgBaseUrl(ORG_ID)).toBe(SUBDOMAIN);
  });

  it("degrades to siteConfig.url and logs when the query errors", async () => {
    stubServiceClient({ orgError: { message: "boom" } });
    expect(await orgBaseUrl(ORG_ID)).toBe(siteConfig.url);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("failed to load org"),
      ORG_ID,
      { message: "boom" },
    );
  });

  it("degrades to siteConfig.url and warns when no row matches", async () => {
    stubServiceClient({ org: null });
    expect(await orgBaseUrl(ORG_ID)).toBe(siteConfig.url);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("no organizations row"),
      ORG_ID,
    );
  });

  it("degrades to siteConfig.url and never throws when the client throws", async () => {
    createServiceClient.mockResolvedValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              throw new Error("boom");
            },
          }),
        }),
      }),
    });
    await expect(orgBaseUrl(ORG_ID)).resolves.toBe(siteConfig.url);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("failed to resolve org"),
      ORG_ID,
      expect.any(Error),
    );
  });
});
