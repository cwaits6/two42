import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn(async () => ({ data: null as unknown, error: null as unknown }));
const createSupabaseJsClient = vi.fn(() => ({ rpc }));

// lookupCustomDomainViaRpc is the one function in this file that talks to a
// real client constructor — resolveHostToOrg's other tests exercise it only
// through an injected stub, and middleware.test.ts mocks this whole module
// too, so nothing else in the suite covers the RPC call shape itself.
vi.mock("@supabase/supabase-js", () => ({
  // Deferred call (not a direct reference) so the hoisted factory never
  // touches the const above before it initializes.
  createClient: () => createSupabaseJsClient(),
}));

// vi.mock is hoisted, so this import sees the mock above.
const {
  createHostResolutionCache,
  lookupCustomDomainViaRpc,
  resolveHostToOrg,
} = await import("@/lib/supabase/host-resolution");

const baseOpts = {
  apex: "two42.io",
  siteUrl: "http://localhost:3000",
  envSlug: "default",
};

describe("resolveHostToOrg", () => {
  it("resolves a subdomain label without ever calling the custom-domain lookup", async () => {
    const lookupCustomDomain = vi.fn(async () => null);
    const result = await resolveHostToOrg("grace.two42.io", {
      ...baseOpts,
      lookupCustomDomain,
    });
    expect(result).toEqual({ orgSlug: "grace", hostResolvedOrg: true });
    expect(lookupCustomDomain).not.toHaveBeenCalled();
  });

  it("resolves no org for the apex host (path-addressed only)", async () => {
    const lookupCustomDomain = vi.fn(async () => null);
    const result = await resolveHostToOrg("two42.io", {
      ...baseOpts,
      lookupCustomDomain,
    });
    expect(result).toEqual({ orgSlug: null, hostResolvedOrg: false });
    expect(lookupCustomDomain).not.toHaveBeenCalled();
  });

  it("resolves no org for a reserved subdomain label", async () => {
    const lookupCustomDomain = vi.fn(async () => null);
    const result = await resolveHostToOrg("admin.two42.io", {
      ...baseOpts,
      lookupCustomDomain,
    });
    expect(result).toEqual({ orgSlug: null, hostResolvedOrg: false });
    expect(lookupCustomDomain).not.toHaveBeenCalled();
  });

  it("resolves a custom domain through the injected lookup", async () => {
    const lookupCustomDomain = vi.fn(async () => "grace");
    const result = await resolveHostToOrg("smallgroup.example.church", {
      ...baseOpts,
      lookupCustomDomain,
    });
    expect(result).toEqual({ orgSlug: "grace", hostResolvedOrg: true });
    expect(lookupCustomDomain).toHaveBeenCalledWith(
      "smallgroup.example.church"
    );
  });

  it("falls back to the env pin for a trusted host the lookup cannot resolve", async () => {
    const lookupCustomDomain = vi.fn(async () => null);
    const result = await resolveHostToOrg("localhost:3000", {
      ...baseOpts,
      lookupCustomDomain,
    });
    expect(result).toEqual({ orgSlug: "default", hostResolvedOrg: false });
  });

  it("resolves no org for an unresolved, untrusted host", async () => {
    const lookupCustomDomain = vi.fn(async () => null);
    const result = await resolveHostToOrg("evil-two42.io", {
      ...baseOpts,
      lookupCustomDomain,
    });
    expect(result).toEqual({ orgSlug: null, hostResolvedOrg: false });
  });
});

describe("lookupCustomDomainViaRpc", () => {
  beforeEach(() => {
    rpc.mockReset();
    createSupabaseJsClient.mockClear();
  });

  it("calls the RPC with the given host and returns the resolved slug", async () => {
    rpc.mockResolvedValueOnce({ data: "grace", error: null });
    const result = await lookupCustomDomainViaRpc("smallgroup.example.church");
    expect(rpc).toHaveBeenCalledWith("app_org_slug_for_host", {
      _host: "smallgroup.example.church",
    });
    expect(result).toBe("grace");
  });

  it("returns null and logs on an RPC error", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error("boom") });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(lookupCustomDomainViaRpc("x.example")).resolves.toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("returns null for an empty-string result", async () => {
    rpc.mockResolvedValueOnce({ data: "", error: null });
    await expect(lookupCustomDomainViaRpc("x.example")).resolves.toBeNull();
  });

  it("returns null and logs when the client constructor throws synchronously", async () => {
    createSupabaseJsClient.mockImplementationOnce(() => {
      throw new Error("missing NEXT_PUBLIC_SUPABASE_URL");
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(lookupCustomDomainViaRpc("x.example")).resolves.toBeNull();
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("createHostResolutionCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-25T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not re-invoke the lookup within the positive TTL", async () => {
    const cached = createHostResolutionCache({
      positiveTtlMs: 1000,
      negativeTtlMs: 100,
    });
    const lookup = vi.fn(async () => "grace");
    await cached("a.example", lookup);
    await cached("a.example", lookup);
    expect(lookup).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(999);
    await cached("a.example", lookup);
    expect(lookup).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2);
    await cached("a.example", lookup);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("expires a negative result sooner than a positive one", async () => {
    const cached = createHostResolutionCache({
      positiveTtlMs: 1000,
      negativeTtlMs: 100,
    });
    const lookup = vi.fn(async () => null);
    await cached("unknown.example", lookup);
    expect(lookup).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(99);
    await cached("unknown.example", lookup);
    expect(lookup).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(2);
    await cached("unknown.example", lookup);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("evicts the oldest entry once maxEntries is reached", async () => {
    const cached = createHostResolutionCache({
      maxEntries: 2,
      positiveTtlMs: 10_000,
    });
    const lookup = vi.fn(async (host: string) => host.split(".")[0]);
    await cached("a.example", lookup);
    await cached("b.example", lookup);
    await cached("c.example", lookup); // evicts a.example
    expect(lookup).toHaveBeenCalledTimes(3);

    await cached("b.example", lookup); // still cached
    expect(lookup).toHaveBeenCalledTimes(3);

    await cached("a.example", lookup); // evicted — must re-invoke
    expect(lookup).toHaveBeenCalledTimes(4);
  });
});
