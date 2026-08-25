import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHostResolutionCache,
  resolveHostToOrg,
} from "@/lib/supabase/host-resolution";

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
