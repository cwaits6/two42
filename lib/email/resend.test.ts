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
  sendGroupInviteEmail,
  sendMemberInviteEmail,
  sendFeedbackEmail,
} = await import("@/lib/email/resend");

const BRANDING = {
  orgName: "Grace Fellowship",
  replyTo: null,
  accent: "#B85C38",
  accentLight: "#c98a68",
  // Distinctive — never equals the platform default, so a call site that
  // reverts to PLATFORM_ADDRESS (or never wired b.fromAddress in) fails loud.
  fromAddress: "noreply@grace.church",
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

  it("sendGroupInviteEmail names the group in the subject and carries the setup link", async () => {
    await sendGroupInviteEmail(
      "a@b.org",
      "Jane <script>",
      "Tuesday Table & Friends",
      "https://grace.church/setup-account?token=abc",
      BRANDING,
    );
    const call = send.mock.calls[0][0];
    expect(call.from).toBe("Grace Fellowship <noreply@grace.church>");
    expect(call.subject).toBe("You're invited to Tuesday Table & Friends at Grace Fellowship");
    expect(call.html).toContain('href="https://grace.church/setup-account?token=abc"');
    expect(call.html).toContain("Tuesday Table &amp; Friends");
    expect(call.html).toContain("Jane &lt;script&gt;");
    expect(call.html).not.toContain("<script>");
  });

  it("sendMemberInviteEmail sends from the resolved branding.fromAddress and escapes the org name", async () => {
    await sendMemberInviteEmail("a@b.org", "https://grace.church/setup-account?token=abc", {
      ...BRANDING,
      orgName: "Grace <b>Fellowship</b>",
    });
    const call = send.mock.calls[0][0];
    expect(call.from).toContain("<noreply@grace.church>");
    expect(call.html).toContain('href="https://grace.church/setup-account?token=abc"');
    expect(call.html).toContain("Grace &lt;b&gt;Fellowship&lt;/b&gt;");
    expect(call.html).not.toContain("<b>Fellowship");
  });

  it("sendGroupInviteEmail refuses a setup link that is not http(s)", async () => {
    await expect(
      sendGroupInviteEmail("a@b.org", "Jane", "Group", "javascript:alert(1)", BRANDING),
    ).rejects.toThrow(/Invalid or unsafe/);
    expect(send).not.toHaveBeenCalled();
  });
});
