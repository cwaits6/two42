// Unit tests for the platform domains list's pure helpers.
// leaseState's boundary is load-bearing: it gates the "Clear expired claim"
// button, and must agree with the retry route's own
// .lt("attach_claimed_at", cutoff) predicate at the exact millisecond the
// lease elapses — see app/api/platform/domains/[id]/retry/route.ts.

import { describe, expect, it } from "vitest";
import { attachmentState, leaseState } from "@/app/platform/domains/DomainsList";
import { ATTACH_LEASE_WINDOW_MS } from "@/lib/domains";

describe("leaseState", () => {
  const CLAIMED = "2026-09-01T00:00:00.000Z";
  const claimedMs = new Date(CLAIMED).getTime();

  it("is none with no claim", () => {
    expect(leaseState(null, claimedMs)).toEqual({ kind: "none" });
  });

  it("is live one millisecond before the window elapses", () => {
    expect(leaseState(CLAIMED, claimedMs + ATTACH_LEASE_WINDOW_MS - 1).kind).toBe("live");
  });

  it("is still live at the exact window boundary, agreeing with the retry route's strict-less-than cutoff", () => {
    expect(leaseState(CLAIMED, claimedMs + ATTACH_LEASE_WINDOW_MS).kind).toBe("live");
  });

  it("is expired one millisecond after the window boundary", () => {
    expect(leaseState(CLAIMED, claimedMs + ATTACH_LEASE_WINDOW_MS + 1).kind).toBe("expired");
  });
});

describe("attachmentState", () => {
  it("labels a removing row as Detach pending", () => {
    expect(attachmentState({ status: "removing", attached_at: null })).toEqual({
      label: "Detach pending",
      variant: "outline",
    });
  });
  it("labels an attached row as Attached", () => {
    expect(
      attachmentState({ status: "verified", attached_at: "2026-09-01T00:00:00Z" }),
    ).toEqual({ label: "Attached", variant: "default" });
  });
  it("labels a verified-but-unattached row as Awaiting attach", () => {
    expect(attachmentState({ status: "verified", attached_at: null })).toEqual({
      label: "Awaiting attach",
      variant: "secondary",
    });
  });
  it("labels a failed row as Check failed", () => {
    expect(attachmentState({ status: "failed", attached_at: null })).toEqual({
      label: "Check failed",
      variant: "destructive",
    });
  });
  it("falls back to Unverified for pending", () => {
    expect(attachmentState({ status: "pending", attached_at: null })).toEqual({
      label: "Unverified",
      variant: "secondary",
    });
  });
});
