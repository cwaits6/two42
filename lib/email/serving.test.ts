// Unit tests for the per-org From: address wiring (Phase 5 PR 7 / CWA-71) at
// the serving-signup email send sites. Same shape as resend.test.ts: mock
// the `resend` package, pass an explicit `branding` object so
// resolveEmailBranding() (and its Supabase calls) never run.

import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn().mockResolvedValue({ data: { id: "test" }, error: null });
vi.mock("resend", () => ({
  // A regular function, not an arrow: getResend() calls `new Resend(...)`,
  // and an arrow-function mock implementation has no [[Construct]] to invoke.
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send } };
  }),
}));

const { sendServingConfirmationEmail, sendServingCancelNoticeEmail, sendServingBroadcastEmail } =
  await import("@/lib/email/serving");

const BRANDING = {
  orgName: "Grace Fellowship",
  replyTo: null,
  accent: "#B85C38",
  accentLight: "#c98a68",
  // Distinctive — never equals the platform default, so a call site that
  // reverts to PLATFORM_ADDRESS (or never wired b.fromAddress in) fails loud.
  fromAddress: "noreply@grace.church",
};

describe("send call sites use the resolved branding.fromAddress", () => {
  beforeEach(() => {
    send.mockClear();
  });

  it("sendServingConfirmationEmail sends from the resolved branding.fromAddress", async () => {
    await sendServingConfirmationEmail({
      to: "a@b.org",
      name: "Jane",
      teamName: "Welcome Team",
      serviceDate: "2026-09-06",
      attendeesLabel: "Jane",
      cancelUrl: "https://x/cancel",
      icsContent: "BEGIN:VCALENDAR\nEND:VCALENDAR",
      branding: BRANDING,
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Grace Fellowship <noreply@grace.church>" }),
    );
  });

  it("sendServingCancelNoticeEmail sends from the resolved branding.fromAddress", async () => {
    await sendServingCancelNoticeEmail({
      to: "leader@b.org",
      leaderName: "Pat",
      memberLabel: "Jane",
      teamName: "Welcome Team",
      serviceDate: "2026-09-06",
      servingUrl: "https://x/serving",
      branding: BRANDING,
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Grace Fellowship <noreply@grace.church>" }),
    );
  });

  it("sendServingBroadcastEmail sends from the resolved branding.fromAddress", async () => {
    await sendServingBroadcastEmail({
      to: "a@b.org",
      name: "Jane",
      teamName: "Welcome Team",
      fromName: "Pat",
      openDates: [{ date: "2026-09-06", url: "https://x/signup" }],
      branding: BRANDING,
    });
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Grace Fellowship <noreply@grace.church>" }),
    );
  });
});
