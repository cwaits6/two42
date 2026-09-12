// Unit tests for the HTML-escaping boundary in email bodies, and for the
// per-org From: address wiring at each send call site. escapeHtml is a pure
// string transform — getResend() is lazy, so
// importing the module alone sends nothing. The send-site tests below mock
// the `resend` package and pass an explicit `branding` object, bypassing
// resolveEmailBranding() entirely — no Supabase mocking needed.

import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn().mockResolvedValue({ data: { id: "test" }, error: null });
vi.mock("resend", () => ({
  // A regular function, not an arrow: getResend() calls `new Resend(...)`,
  // and an arrow-function mock implementation has no [[Construct]] to invoke.
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send } };
  }),
}));

const {
  escapeHtml,
  sendInviteEmail,
  sendFamilyInviteEmail,
  sendFeedbackEmail,
  sendEventReminderEmail,
} = await import("@/lib/email/resend");

const BRANDING = {
  orgName: "Grace Fellowship",
  replyTo: null,
  accent: "#B85C38",
  accentLight: "#c98a68",
  // Distinctive — never equals the platform default, so a call site that
  // reverts to PLATFORM_ADDRESS (or never wired b.fromAddress in) fails loud.
  fromAddress: "noreply@grace.church",
  // Same idea for links: never equals siteConfig.url, so a body builder that
  // still reads the platform constant fails loud.
  baseUrl: "https://grace.church",
};

describe("escapeHtml", () => {
  it("escapes all five HTML entities", () => {
    expect(escapeHtml("&")).toBe("&amp;");
    expect(escapeHtml("<")).toBe("&lt;");
    expect(escapeHtml(">")).toBe("&gt;");
    expect(escapeHtml('"')).toBe("&quot;");
    expect(escapeHtml("'")).toBe("&#39;");
  });

  it("escapes & first so entities are not double-escaped", () => {
    expect(escapeHtml("<&>")).toBe("&lt;&amp;&gt;");
    // An already-escaped entity is re-escaped (correct: input is plain text).
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("neutralizes an XSS payload", () => {
    const escaped = escapeHtml('<img src=x onerror=alert(1)>');
    expect(escaped).not.toContain("<");
    expect(escaped).not.toContain(">");
    expect(escaped).toBe("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("leaves benign text untouched", () => {
    expect(escapeHtml("Grace Chapel — Sunday 9:30")).toBe("Grace Chapel — Sunday 9:30");
  });
});

// ── From: address wiring: every send site must use b.fromAddress ───────────

describe("send call sites use the resolved branding.fromAddress", () => {
  beforeEach(() => {
    send.mockClear();
  });

  it("sendInviteEmail sends from the resolved branding.fromAddress", async () => {
    await sendInviteEmail("a@b.org", "Jane", "https://x/y", BRANDING);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Grace Fellowship <noreply@grace.church>" }),
    );
  });

  it("sendFamilyInviteEmail sends from the resolved branding.fromAddress", async () => {
    await sendFamilyInviteEmail("a@b.org", "Jane", "Sam", "https://x/y", BRANDING);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Grace Fellowship <noreply@grace.church>" }),
    );
  });

  it("sendFeedbackEmail sends from the resolved branding.fromAddress", async () => {
    await sendFeedbackEmail(["a@b.org"], "Jane", null, "idea", "hi", BRANDING);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Grace Fellowship <noreply@grace.church>" }),
    );
  });

  it("sendEventReminderEmail sends from the resolved branding.fromAddress", async () => {
    await sendEventReminderEmail("a@b.org", "Jane", "Potluck", "2026-09-06", null, BRANDING);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "Grace Fellowship <noreply@grace.church>" }),
    );
  });
});

// ── Link origin: every in-body link must use b.baseUrl, never siteConfig.url ─

describe("send call sites build links from the resolved branding.baseUrl", () => {
  beforeEach(() => {
    send.mockClear();
  });

  it("sendEventReminderEmail links to /events on the org's own host", async () => {
    await sendEventReminderEmail("a@b.org", "Jane", "Potluck", "2026-09-06", null, BRANDING);
    const { html } = send.mock.calls[0][0];
    expect(html).toContain('href="https://grace.church/events"');
    expect(html).not.toContain("localhost:3000");
  });
});
