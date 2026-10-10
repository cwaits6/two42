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

describe("legacy group routes and the group cookie", () => {
  const A = "11111111-1111-4111-8111-111111111111";
  const B = "22222222-2222-4222-8222-222222222222";
  const Z = "99999999-9999-4999-8999-999999999999";

  type Row = Record<string, unknown>;
  type TableResult = { data: Row | Row[] | null; error: unknown };

  // Every builder method returns the chain; awaiting it yields the result.
  function chain(result: TableResult) {
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order", "single", "maybeSingle"]) {
      c[m] = () => c;
    }
    c.then = (resolve: (v: TableResult) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result).then(resolve, reject);
    return c;
  }

  const from = vi.fn<(table: string) => unknown>();

  function signedIn(opts: {
    profile?: Row | null;
    memberships?: Row[];
  }) {
    getUser.mockResolvedValue({
      data: { user: { id: "user-1" } as unknown as null },
    });
    const profile =
      opts.profile === undefined ? { role: "member", org_id: "org-1" } : opts.profile;
    from.mockImplementation((table: string) => {
      if (table === "profiles") return chain({ data: profile, error: null });
      if (table === "group_members") return chain({ data: opts.memberships ?? [], error: null });
      throw new Error(`unexpected table ${table}`);
    });
  }

  const membershipRows = [
    { group_id: A, role: "leader", groups: { name: "Grace" } },
    { group_id: B, role: "member", groups: { name: "Hope" } },
  ];

  function get(path: string, cookie?: string) {
    return new NextRequest(`https://two42.io${path}`, {
      headers: { host: "two42.io", ...(cookie ? { cookie } : {}) },
    });
  }

  function location(res: Response) {
    const value = res.headers.get("location");
    if (!value) return null;
    const url = new URL(value);
    return url.pathname + url.search;
  }

  beforeEach(() => {
    from.mockReset();
    getUser.mockReset();
    getUser.mockResolvedValue({ data: { user: null } });
    createServerClient.mockImplementation(() => ({
      auth: { getUser },
      rpc: vi.fn(async () => ({ data: null, error: null })),
      from,
    }));
    process.env.NEXT_PUBLIC_ORG_SLUG = "default";
  });

  it("redirects a legacy section under the cookie's group, query string preserved", async () => {
    signedIn({ memberships: membershipRows });
    const res = await updateSession(get("/announcements?tab=x", `two42-group=${B}`));
    expect(res.status).toBe(307);
    expect(location(res)).toBe(`/g/${B}/announcements?tab=x`);
  });

  it("sends bare /events to /calendar with the query string and no membership query", async () => {
    signedIn({ memberships: membershipRows });
    const res = await updateSession(get("/events?view=month"));
    expect(location(res)).toBe("/calendar?view=month");
    expect(from).not.toHaveBeenCalledWith("group_members");
  });

  it("ignores a stale cookie and falls back to the first membership", async () => {
    signedIn({ memberships: membershipRows });
    const res = await updateSession(get("/lectures/abc", `two42-group=${Z}`));
    expect(location(res)).toBe(`/g/${A}/lectures/abc`);
  });

  it("sends a member of no group to Home", async () => {
    signedIn({ memberships: [] });
    const res = await updateSession(get("/prayer"));
    expect(location(res)).toBe("/dashboard");
  });

  it("leaves /serving/go alone for signed-in and anonymous visitors", async () => {
    signedIn({ memberships: membershipRows });
    expect(location(await updateSession(get("/serving/go?token=x")))).toBeNull();

    getUser.mockResolvedValue({ data: { user: null } });
    expect(location(await updateSession(get("/serving/go?token=x")))).toBeNull();
  });

  it("requires login for legacy and group paths but not for a slug starting with g", async () => {
    expect(location(await updateSession(get("/announcements")))).toBe(
      "/login?redirect=%2Fannouncements"
    );
    expect(location(await updateSession(get(`/g/${A}/dashboard`)))).toBe(
      `/login?redirect=%2Fg%2F${A}%2Fdashboard`
    );
    expect(location(await updateSession(get("/calendar")))).toBe("/login?redirect=%2Fcalendar");
    expect(location(await updateSession(get("/grace/join")))).toBeNull();
    expect(location(await updateSession(get("/give-thanks")))).toBeNull();
  });

  it("writes the host-scoped group cookie on a group page and nowhere else", async () => {
    signedIn({ memberships: membershipRows });
    const res = await updateSession(get(`/g/${A}/calendar`));
    const cookie = res.cookies.get("two42-group");
    expect(cookie?.value).toBe(A);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
    expect(cookie?.domain).toBeUndefined();

    const malformed = await updateSession(get("/g/not-a-uuid/x"));
    expect(malformed.cookies.get("two42-group")).toBeUndefined();
    const orgLevel = await updateSession(get("/calendar"));
    expect(orgLevel.cookies.get("two42-group")).toBeUndefined();
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
