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

// siteConfig reads the env once at import, so the canonical host has to be
// in place before the middleware module loads.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SITE_URL = "https://two42.io";
});

// vi.mock is hoisted, so this import sees the mocks above.
import { updateSession } from "@/lib/supabase/middleware";

describe("updateSession — expected host", () => {
  beforeEach(() => {
    createServerClient.mockClear();
    process.env.NEXT_PUBLIC_ORG_SLUG = "default";
  });

  it("serves the canonical host with the env-pinned org", async () => {
    const req = new NextRequest("https://two42.io/", {
      headers: { host: "two42.io" },
    });
    const res = await updateSession(req);
    expect(res.status).not.toBe(404);
    const config = createServerClient.mock.calls[0][2];
    expect(config.global.headers["x-two42-org"]).toBe("default");
  });

  it("serves the canonical host regardless of case, port, or a trailing dot", async () => {
    const req = new NextRequest("https://two42.io/", {
      headers: { host: "Two42.IO.:443" },
    });
    const res = await updateSession(req);
    expect(res.status).not.toBe(404);
  });

  it("serves localhost with the env-pinned org", async () => {
    const req = new NextRequest("http://localhost:3000/", {
      headers: { host: "localhost:3000" },
    });
    const res = await updateSession(req);
    expect(res.status).not.toBe(404);
    const config = createServerClient.mock.calls[0][2];
    expect(config.global.headers["x-two42-org"]).toBe("default");
  });

  it("404s on an org subdomain of the canonical host", async () => {
    const req = new NextRequest("https://grace.two42.io/", {
      headers: { host: "grace.two42.io" },
    });
    const res = await updateSession(req);
    expect(res.status).toBe(404);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("404s on an unrelated host", async () => {
    const req = new NextRequest("https://some-random-domain.example/", {
      headers: { host: "some-random-domain.example" },
    });
    const res = await updateSession(req);
    expect(res.status).toBe(404);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("never derives the org from a client-sent header", async () => {
    const req = new NextRequest("https://two42.io/", {
      headers: {
        host: "two42.io",
        "x-two42-org": "attacker-org",
      },
    });
    await updateSession(req);
    const config = createServerClient.mock.calls[0][2];
    expect(config.global.headers["x-two42-org"]).toBe("default");
  });
});

describe("cookie scope regression", () => {
  it("never opts into a cross-host cookie Domain in the Supabase client config", () => {
    // Cheap tripwire, not a behavioral guarantee: catches the common case
    // (someone adding a `cookieOptions: {...}` config key directly) before
    // it ships. The behavioral test below is what actually exercises the
    // regression class this describe block is named for — see it for the
    // real observable contract.
    //
    // Session cookies must stay host-scoped: a Domain=<apex> cookie would
    // be sent to every subdomain of the canonical host, none of which this
    // app serves. @supabase/ssr only widens cookie scope through an explicit
    // cookieOptions config, so its absence pins the default host-only
    // behavior.
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
    const req = new NextRequest("https://two42.io/", {
      headers: { host: "two42.io" },
    });
    const res = await updateSession(req);
    const setCookie = res.cookies.get("sb-access-token");
    expect(setCookie).toBeDefined();
    expect(setCookie?.domain).toBeUndefined();
  });
});
