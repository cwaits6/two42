import { describe, expect, it } from "vitest";
import { sanitizeNext } from "./sanitize-next";

describe("sanitizeNext", () => {
  it("accepts a plain path", () => {
    expect(sanitizeNext("/update-password")).toBe("/update-password");
  });

  it("accepts a path with query/hash", () => {
    expect(sanitizeNext("/join?email=a@b.com#top")).toBe(
      "/join?email=a@b.com#top"
    );
  });

  it("defaults for null/empty", () => {
    expect(sanitizeNext(null)).toBe("/dashboard");
    expect(sanitizeNext("")).toBe("/dashboard");
  });

  it("rejects a protocol-relative //host", () => {
    expect(sanitizeNext("//evil.com")).toBe("/dashboard");
  });

  it("rejects a scheme-ish prefix", () => {
    expect(sanitizeNext("javascript:alert(1)")).toBe("/dashboard");
    expect(sanitizeNext("https://evil.com/x")).toBe("/dashboard");
  });

  it("rejects a path missing the leading slash", () => {
    expect(sanitizeNext("dashboard")).toBe("/dashboard");
  });

  it("rejects a backslash-disguised host", () => {
    // WHATWG URL parsing treats \\ like // — must not slip through.
    expect(sanitizeNext("/\\evil.com")).toBe("/dashboard");
    expect(sanitizeNext("\\\\evil.com")).toBe("/dashboard");
  });
});
