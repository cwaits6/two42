import { describe, expect, it } from "vitest";
import { isExpectedHost, normalizeHost } from "@/lib/org";

describe("normalizeHost", () => {
  it("lowercases", () => {
    expect(normalizeHost("Grace.Two42.IO")).toBe("grace.two42.io");
  });

  it("strips a trailing dot", () => {
    expect(normalizeHost("grace.two42.io.")).toBe("grace.two42.io");
  });

  it("strips a port", () => {
    expect(normalizeHost("localhost:3000")).toBe("localhost");
  });

  it("handles all three at once", () => {
    expect(normalizeHost(" Grace.Two42.IO.:443 ")).toBe("grace.two42.io");
  });
});

describe("isExpectedHost", () => {
  const siteUrl = "http://localhost:3000";

  it("accepts localhost and 127.0.0.1", () => {
    expect(isExpectedHost("localhost", { siteUrl })).toBe(true);
    expect(isExpectedHost("127.0.0.1", { siteUrl })).toBe(true);
  });

  it("accepts vercel preview hosts", () => {
    expect(
      isExpectedHost("my-app-git-main.vercel.app", { siteUrl })
    ).toBe(true);
  });

  it("accepts the canonical NEXT_PUBLIC_SITE_URL host", () => {
    expect(
      isExpectedHost("two42.io", { siteUrl: "https://two42.io" })
    ).toBe(true);
  });

  it("rejects an unrelated host", () => {
    expect(isExpectedHost("evil.example", { siteUrl })).toBe(false);
  });

  it("rejects a subdomain of the canonical host", () => {
    expect(
      isExpectedHost("grace.two42.io", { siteUrl: "https://two42.io" })
    ).toBe(false);
  });

  it("rejects a host that merely ends with the canonical host string", () => {
    expect(
      isExpectedHost("evil-two42.io", { siteUrl: "https://two42.io" })
    ).toBe(false);
  });

  it("does not throw on a malformed siteUrl", () => {
    expect(
      isExpectedHost("evil.example", { siteUrl: "not a url" })
    ).toBe(false);
  });
});
