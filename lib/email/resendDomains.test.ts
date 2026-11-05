// Unit tests for the shared Resend-domain-removal primitive. This pins the
// contract both app/api/admin/email-domain/route.ts and the platform
// cleanup-retry route rely on, directly against a mocked `resend` module
// rather than re-deriving it from either caller's route tests.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { loggedLines } from "@/lib/log/testing";

const domainsRemove = vi.fn();
vi.mock("resend", () => ({
  Resend: class {
    domains = { remove: (...args: unknown[]) => domainsRemove(...args) };
  },
}));

const { removeResendDomain } = await import("@/lib/email/resendDomains");

beforeEach(() => {
  domainsRemove.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("removeResendDomain", () => {
  it("returns true on success", async () => {
    domainsRemove.mockResolvedValue({ error: null });
    await expect(
      removeResendDomain("rd-1", { orgId: "org-1", context: "test" }),
    ).resolves.toBe(true);
    expect(domainsRemove).toHaveBeenCalledWith("rd-1");
  });

  it("treats not_found as already-cleaned-up (true), logged at warn", async () => {
    domainsRemove.mockResolvedValue({
      error: { name: "not_found", message: "gone" },
    });
    await expect(
      removeResendDomain("rd-1", { orgId: "org-1", context: "test" }),
    ).resolves.toBe(true);
    expect(loggedLines(vi.mocked(console.log)).map((l) => l.level)).toEqual(["warn"]);
  });

  it("returns false for any other error, and cannot be spoofed by message text alone", async () => {
    domainsRemove.mockResolvedValue({
      error: { name: "application_error", message: "not_found-ish but not really" },
    });
    await expect(
      removeResendDomain("rd-1", { orgId: "org-1", context: "test" }),
    ).resolves.toBe(false);
    expect(loggedLines(vi.mocked(console.log)).map((l) => l.level)).toEqual(["error"]);
  });

  it("returns false (never throws) when the SDK call itself throws", async () => {
    domainsRemove.mockRejectedValue(new Error("network reset"));
    await expect(
      removeResendDomain("rd-1", { orgId: "org-1", context: "test" }),
    ).resolves.toBe(false);
    expect(loggedLines(vi.mocked(console.log)).map((l) => l.level)).toEqual(["error"]);
  });
});
