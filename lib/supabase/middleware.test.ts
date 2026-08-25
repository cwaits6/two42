import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type MockClientConfig = {
  global: { headers: Record<string, string> };
  cookies: {
    setAll: (
      cookies: {
        name: string;
        value: string;
        options?: Record<string, unknown>;
      }[]
    ) => void;
  };
};

const getUser = vi.fn(async () => ({ data: { user: null } }));
const createServerClient = vi.fn<
  (url: string, key: string, config: MockClientConfig) => unknown
>(() => ({
  auth: { getUser },
  rpc: vi.fn(async () => ({ data: null, error: null })),
  from: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  // Deferred call (not a direct reference) so the hoisted factory never
  // touches the const above before it initializes.
  createServerClient: (url: string, key: string, config: MockClientConfig) =>
    createServerClient(url, key, config),
}));

// The custom-domain RPC path constructs a bare supabase-js client; stub it
// so the trusted-fallback test never attempts a network call. Its behavior
// in isolation is covered by host-resolution.test.ts. Exposed as a shared
// fn (not an inline default) so individual tests can override its return
// value for the custom-domain path.
const customDomainRpc = vi.fn(async () => ({
  data: null as string | null,
  error: null as unknown,
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ rpc: customDomainRpc })),
}));

// vi.mock is hoisted, so this import sees the mocks above.
import { updateSession } from "@/lib/supabase/middleware";

/**
 * NextResponse.next({ request: { headers } }) exposes the overridden
 * request headers on the response as x-middleware-request-<name> (with the
 * full list in x-middleware-override-headers) — that is how the Next
 * runtime itself transports them, and it makes the forwarded values
 * directly observable here.
 */
function forwardedRequestHeader(res: Response, name: string): string | null {
  return res.headers.get(`x-middleware-request-${name}`);
}

describe("updateSession — host resolution (Phase 5 PR 3, CWA-67)", () => {
  beforeEach(() => {
    createServerClient.mockClear();
    customDomainRpc.mockClear();
    delete process.env.NEXT_PUBLIC_ORG_SLUG;
  });

  it("sets x-two42-resolved-org for a valid subdomain host", async () => {
    const req = new NextRequest("https://grace.two42.io/", {
      headers: { host: "grace.two42.io" },
    });
    const res = await updateSession(req);
    // NOT a plain response header — only the forwarded-request encoding.
    expect(res.headers.get("x-two42-resolved-org")).toBeNull();
    expect(forwardedRequestHeader(res, "x-two42-resolved-org")).toBe("grace");
    // The Supabase client itself is built with the host-resolved org.
    const config = createServerClient.mock.calls[0][2];
    expect(config.global.headers["x-two42-org"]).toBe("grace");
  });

  it("strips an inbound x-two42-resolved-org header from an untrusted client", async () => {
    const req = new NextRequest("https://grace.two42.io/", {
      headers: {
        host: "grace.two42.io",
        "x-two42-resolved-org": "attacker-org",
      },
    });
    const res = await updateSession(req);
    expect(forwardedRequestHeader(res, "x-two42-resolved-org")).toBe("grace");
  });

  it("404s on an unresolved, untrusted host", async () => {
    const req = new NextRequest("https://some-random-domain.example/", {
      headers: { host: "some-random-domain.example" },
    });
    const res = await updateSession(req);
    expect(res.status).toBe(404);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("404s on a reserved subdomain label", async () => {
    const req = new NextRequest("https://admin.two42.io/", {
      headers: { host: "admin.two42.io" },
    });
    const res = await updateSession(req);
    expect(res.status).toBe(404);
  });

  it("falls back to the env-pinned org on a trusted host without setting x-two42-resolved-org", async () => {
    process.env.NEXT_PUBLIC_ORG_SLUG = "default";
    const req = new NextRequest("http://localhost:3000/", {
      headers: { host: "localhost:3000" },
    });
    const res = await updateSession(req);
    expect(res.status).not.toBe(404);
    // Resolved-org header must be ABSENT (trusted fallback), per the §5.2
    // header contract lib/supabase/server.ts's default depends on.
    expect(forwardedRequestHeader(res, "x-two42-resolved-org")).toBeNull();
    const config = createServerClient.mock.calls[0][2];
    expect(config.global.headers["x-two42-org"]).toBe("default");
  });

  it("strips an inbound x-two42-resolved-org even on the trusted-host fallback", async () => {
    const req = new NextRequest("http://localhost:3000/", {
      headers: {
        host: "localhost:3000",
        "x-two42-resolved-org": "attacker-org",
      },
    });
    const res = await updateSession(req);
    expect(forwardedRequestHeader(res, "x-two42-resolved-org")).toBeNull();
  });

  it("omits x-two42-resolved-org but still forwards a malformed custom-domain slug to x-two42-org", async () => {
    // Only reachable via the custom-domain RPC path — classifyHost's
    // subdomain branch already validates the slug before returning it, and
    // organizations.slug is DB-constrained to valid slugs, so this is
    // unlikely in practice. Pins the actual (fail-open on x-two42-org,
    // fail-closed on the forwarded trust signal) behavior as an explicit,
    // reviewable contract rather than an untested assumption.
    customDomainRpc.mockResolvedValueOnce({ data: "Bad Slug!", error: null });
    const req = new NextRequest("https://custom-domain-malformed.example/", {
      headers: { host: "custom-domain-malformed.example" },
    });
    const res = await updateSession(req);
    expect(forwardedRequestHeader(res, "x-two42-resolved-org")).toBeNull();
    const config = createServerClient.mock.calls[0][2];
    expect(config.global.headers["x-two42-org"]).toBe("Bad Slug!");
  });
});

describe("cookie scope regression (§5.4)", () => {
  it("never opts into a cross-host cookie Domain in the Supabase client config", () => {
    // Cheap tripwire, not a behavioral guarantee: catches the common case
    // (someone adding a `cookieOptions: {...}` config key directly) before
    // it ships. The behavioral test below is what actually exercises the
    // regression class this describe block is named for — see it for the
    // real observable contract.
    //
    // Session cookies must stay host-scoped: a Domain=<apex> cookie would
    // leak one org's session onto every other org's subdomain. @supabase/ssr
    // only widens cookie scope through an explicit cookieOptions config, so
    // its absence pins the default host-only behavior.
    for (const rel of ["server.ts", "client.ts", "middleware.ts"]) {
      const src = readFileSync(
        fileURLToPath(new URL(`./${rel}`, import.meta.url)),
        "utf8"
      );
      expect(src).not.toContain("cookieOptions");
    }
  });

  it("sets cookies without a Domain attribute (host-scoped only)", async () => {
    // Behavioral counterpart to the text-based tripwire above: simulates
    // @supabase/ssr invoking the `cookies.setAll` hook the middleware wired
    // up (the way a real session refresh would) and asserts on the actual
    // emitted cookie, not on source text — so this catches a Domain=<apex>
    // regression introduced through any indirection (a spread, a renamed
    // local, a hardcoded option) that the grep above would miss.
    createServerClient.mockImplementationOnce(
      (_url: string, _key: string, config: MockClientConfig) => {
        config.cookies.setAll([
          { name: "sb-access-token", value: "x", options: { path: "/" } },
        ]);
        return {
          auth: { getUser },
          rpc: vi.fn(async () => ({ data: null, error: null })),
          from: vi.fn(),
        };
      }
    );
    const req = new NextRequest("https://grace.two42.io/", {
      headers: { host: "grace.two42.io" },
    });
    const res = await updateSession(req);
    const setCookie = res.cookies.get("sb-access-token");
    expect(setCookie).toBeDefined();
    expect(setCookie?.domain).toBeUndefined();
  });
});
