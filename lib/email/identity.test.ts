// Unit tests for the RFC 5322 From: construction boundary (CWA-55) and the
// per-org From: address gate (Phase 5 PR 7 / CWA-71). formatFromHeader and
// parseAddress stay pure units; resolveEmailBranding runs against stubbed
// Supabase clients — no network, no database, no request context.

import { beforeEach, describe, expect, it, vi } from "vitest";

const createClient = vi.fn();
const createServiceClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
  createServiceClient: () => createServiceClient(),
}));

const { formatFromHeader, parseAddress, resolveEmailBranding, PLATFORM_ADDRESS } =
  await import("@/lib/email/identity");

const ADDRESS = "noreply@example.org";

describe("formatFromHeader", () => {
  it("emits a plain name unquoted", () => {
    expect(formatFromHeader("two42", ADDRESS)).toBe(`two42 <${ADDRESS}>`);
  });

  it("keeps dots on the plain branch (PLAIN_NAME includes `.`)", () => {
    expect(formatFromHeader("Dr. Smith", ADDRESS)).toBe(`Dr. Smith <${ADDRESS}>`);
  });

  it("strips CR/LF unconditionally (header injection)", () => {
    const result = formatFromHeader("Evil\r\nBcc: attacker@evil.com", ADDRESS);
    expect(result).not.toContain("\r");
    expect(result).not.toContain("\n");
    // The stripped remainder contains `:` and `@`, so it takes the quoted
    // branch — inert display text, not a second header.
    expect(result).toBe(`"EvilBcc: attacker@evil.com" <${ADDRESS}>`);
  });

  it("emits the bare address for empty and whitespace-only names", () => {
    expect(formatFromHeader("", ADDRESS)).toBe(ADDRESS);
    expect(formatFromHeader("   ", ADDRESS)).toBe(ADDRESS);
    expect(formatFromHeader("\r\n", ADDRESS)).toBe(ADDRESS);
  });

  it("quotes names outside the plain subset", () => {
    expect(formatFromHeader("Smith, Dr", ADDRESS)).toBe(`"Smith, Dr" <${ADDRESS}>`);
  });

  it("escapes double quotes inside the quoted string", () => {
    expect(formatFromHeader('Say "Hi"', ADDRESS)).toBe(`"Say \\"Hi\\"" <${ADDRESS}>`);
  });

  it("escapes backslashes inside the quoted string", () => {
    expect(formatFromHeader("a\\b", ADDRESS)).toBe(`"a\\\\b" <${ADDRESS}>`);
  });

  it("neutralizes an embedded-address injection attempt", () => {
    const result = formatFromHeader('Evil" <x@evil.com> "', ADDRESS);
    // The whole payload stays inside one quoted string; the only address a
    // parser finds at the tail is the real one.
    expect(parseAddress(result)).toBe(ADDRESS);
    expect(result.endsWith(`<${ADDRESS}>`)).toBe(true);
  });

  it("passes non-ASCII names through the quoted branch unmangled", () => {
    expect(formatFromHeader("Iglesia Café", ADDRESS)).toBe(`"Iglesia Café" <${ADDRESS}>`);
  });

  it("handles an oversized name without throwing and emits one address", () => {
    const huge = "x".repeat(10_000);
    const result = formatFromHeader(huge, ADDRESS);
    expect(result.split("<").length - 1).toBe(1);
    expect(result.endsWith(`<${ADDRESS}>`)).toBe(true);
  });
});

describe("parseAddress", () => {
  it("extracts the address from a display-name form", () => {
    expect(parseAddress(`two42 <${ADDRESS}>`)).toBe(ADDRESS);
  });

  it("returns a bare address unchanged", () => {
    expect(parseAddress("a@b.org")).toBe("a@b.org");
  });

  it("trims surrounding whitespace", () => {
    expect(parseAddress("  a@b.org  ")).toBe("a@b.org");
    expect(parseAddress("Name <x@y.z>   ")).toBe("x@y.z");
  });

  it("falls back to the whole trimmed input on nested/garbage angle brackets", () => {
    // `<([^<>]+)>` cannot match across the doubled closer, and the match is
    // anchored to the tail — so no partial address is invented.
    expect(parseAddress("a <b <c@d.e>>")).toBe("a <b <c@d.e>>");
  });
});

// ── resolveEmailBranding: the per-org From: address gate (CWA-71) ────────────

const ORG_ID = "11111111-2222-3333-4444-555555555555";

interface ServiceStub {
  org?: { branding: unknown } | null;
  orgError?: { message: string } | null;
  domainRow?: { domain: string; status: string } | null;
  domainError?: { message: string } | null;
}

/** Records every eq() so tests can assert the tenant filters were applied. */
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
        maybeSingle: async () =>
          table === "organizations"
            ? { data: opts.org ?? null, error: opts.orgError ?? null }
            : { data: opts.domainRow ?? null, error: opts.domainError ?? null },
      };
    },
  };
  createServiceClient.mockResolvedValue(client);
  return { filters };
}

/** The cookie-bound request client: getOrgBranding + resolveRequestOrgId. */
function stubRequestClient(opts: {
  branding?: unknown;
  rpcOrgId?: string | null;
  rpcError?: { message: string } | null;
}) {
  const client = {
    from() {
      return {
        select() {
          return this;
        },
        maybeSingle: async () => ({
          data: opts.branding === undefined ? null : { branding: opts.branding },
          error: null,
        }),
      };
    },
    rpc: async () => ({ data: opts.rpcOrgId ?? null, error: opts.rpcError ?? null }),
  };
  createClient.mockResolvedValue(client);
}

beforeEach(() => {
  createClient.mockReset();
  createServiceClient.mockReset();
  vi.spyOn(console, "debug").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("resolveEmailBranding (orgId path)", () => {
  it("uses noreply@<domain> for a verified row with a valid domain", async () => {
    const { filters } = stubServiceClient({
      org: { branding: { display_name: "Grace Fellowship" } },
      domainRow: { domain: "grace.church", status: "verified" },
    });
    const b = await resolveEmailBranding(ORG_ID);
    expect(b.fromAddress).toBe("noreply@grace.church");
    expect(b.orgName).toBe("Grace Fellowship");
    // Both reads carry their tenant filter — the only boundary on a
    // service-role client.
    expect(filters).toContainEqual({ table: "organizations", column: "id", value: ORG_ID });
    expect(filters).toContainEqual({
      table: "org_email_domains",
      column: "org_id",
      value: ORG_ID,
    });
  });

  it("falls back to the platform address and logs for a verified row with an invalid domain", async () => {
    const invalid = [
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
    ];
    for (const domain of invalid) {
      stubServiceClient({
        org: { branding: {} },
        domainRow: { domain, status: "verified" },
      });
      const b = await resolveEmailBranding(ORG_ID);
      expect(b.fromAddress, `domain ${JSON.stringify(domain)} must be rejected`).toBe(
        PLATFORM_ADDRESS,
      );
    }
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("failed SENDING_DOMAIN"),
      expect.anything(),
    );
  });

  it("falls back to the platform address for every non-verified status", async () => {
    // Several distinct statuses, not just one: the gate is equality to
    // 'verified', so any future addition to the status vocabulary must land
    // on the fallback side of this same test shape.
    for (const status of ["not_started", "pending", "failure", "temporary_failure", "failed"]) {
      stubServiceClient({
        org: { branding: {} },
        domainRow: { domain: "grace.church", status },
      });
      const b = await resolveEmailBranding(ORG_ID);
      expect(b.fromAddress, `status ${status} must not substitute`).toBe(PLATFORM_ADDRESS);
    }
  });

  it("falls back to the platform address when the org has no domain row", async () => {
    stubServiceClient({ org: { branding: {} }, domainRow: null });
    const b = await resolveEmailBranding(ORG_ID);
    expect(b.fromAddress).toBe(PLATFORM_ADDRESS);
  });

  it("falls back to the platform address and logs when the domain query errors", async () => {
    stubServiceClient({
      org: { branding: { display_name: "Grace Fellowship" } },
      domainError: { message: "boom" },
    });
    const b = await resolveEmailBranding(ORG_ID);
    expect(b.fromAddress).toBe(PLATFORM_ADDRESS);
    // The branding read succeeded — only the From: address degrades.
    expect(b.orgName).toBe("Grace Fellowship");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load sending domain"),
      ORG_ID,
      { message: "boom" },
    );
  });

  it("keeps the platform address on branding fallback branches", async () => {
    stubServiceClient({ orgError: { message: "down" } });
    const b = await resolveEmailBranding(ORG_ID);
    expect(b.fromAddress).toBe(PLATFORM_ADDRESS);
  });
});

describe("resolveEmailBranding (self-resolving path)", () => {
  it("reaches the same gate once the request org resolves", async () => {
    stubRequestClient({ branding: { display_name: "Request Org" }, rpcOrgId: ORG_ID });
    const { filters } = stubServiceClient({
      domainRow: { domain: "grace.church", status: "verified" },
    });
    const b = await resolveEmailBranding();
    expect(b.fromAddress).toBe("noreply@grace.church");
    expect(b.orgName).toBe("Request Org");
    expect(filters).toContainEqual({
      table: "org_email_domains",
      column: "org_id",
      value: ORG_ID,
    });
  });

  it("applies the verified gate on this path too", async () => {
    stubRequestClient({ branding: {}, rpcOrgId: ORG_ID });
    stubServiceClient({ domainRow: { domain: "grace.church", status: "pending" } });
    const b = await resolveEmailBranding();
    expect(b.fromAddress).toBe(PLATFORM_ADDRESS);
  });

  it("still returns branding with the platform address when no org resolves", async () => {
    stubRequestClient({ branding: { display_name: "Request Org" }, rpcOrgId: null });
    const b = await resolveEmailBranding();
    expect(b.fromAddress).toBe(PLATFORM_ADDRESS);
    expect(b.orgName).toBe("Request Org");
    // Fail-closed to the platform address, never a blocked email — and no
    // service-role query runs without a resolved org to scope it to.
    expect(createServiceClient).not.toHaveBeenCalled();
  });

  it("falls back to the platform address and logs when the domain query errors", async () => {
    stubRequestClient({ branding: { display_name: "Request Org" }, rpcOrgId: ORG_ID });
    stubServiceClient({ domainError: { message: "boom" } });
    const b = await resolveEmailBranding();
    expect(b.fromAddress).toBe(PLATFORM_ADDRESS);
    // The branding read already succeeded — only the From: address degrades.
    expect(b.orgName).toBe("Request Org");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load sending domain"),
      ORG_ID,
      { message: "boom" },
    );
  });

  it("falls back to the platform address when the org has no domain row", async () => {
    stubRequestClient({ branding: { display_name: "Request Org" }, rpcOrgId: ORG_ID });
    stubServiceClient({ domainRow: null });
    const b = await resolveEmailBranding();
    expect(b.fromAddress).toBe(PLATFORM_ADDRESS);
    expect(b.orgName).toBe("Request Org");
  });

  it("degrades only the From: address, never the already-resolved branding, when the domain query throws", async () => {
    // Regression test for the fix isolating the sending-domain lookup in its
    // own total-by-contract helper: a *thrown* (not returned-`error`)
    // failure from the org_email_domains query must not wipe the org
    // name/replyTo/accent that getOrgBranding() already resolved before the
    // domain lookup even began.
    stubRequestClient({ branding: { display_name: "Request Org" }, rpcOrgId: ORG_ID });
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
    const b = await resolveEmailBranding();
    expect(b.fromAddress).toBe(PLATFORM_ADDRESS);
    expect(b.orgName).toBe("Request Org");
  });
});
