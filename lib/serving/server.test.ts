// Narrow smoke test for the org-base-url wiring in sendSignupConfirmation()
// and notifyLeadersOfCancel(): both now build
// cancelUrl/servingUrl from orgBaseUrl(opts.orgId) instead of the
// deployment's env-pinned siteConfig.url. This mocks every collaborator
// (same mock-the-collaborator shape as lib/email/resend.test.ts) and asserts
// only the delta this PR introduces — the built URL starts with the
// resolved org host — not the file's broader pre-existing behavior (quota
// reservation, resolveCanSign interaction), which has no coverage before or
// after this PR and is out of scope here.

import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveEmailBranding = vi.fn();
vi.mock("@/lib/email/identity", () => ({
  resolveEmailBranding: (...args: unknown[]) => resolveEmailBranding(...args),
}));

const orgBaseUrl = vi.fn();
vi.mock("@/lib/org-urls", () => ({
  orgBaseUrl: (...args: unknown[]) => orgBaseUrl(...args),
}));

const getServingLinkMode = vi.fn();
vi.mock("@/lib/serving/config", () => ({
  getServingLinkMode: (...args: unknown[]) => getServingLinkMode(...args),
}));

const createServingToken = vi.fn<(...args: unknown[]) => string>(() => "signed-token");
vi.mock("@/lib/serving/links", () => ({
  createServingToken: (...args: unknown[]) => createServingToken(...args),
}));

const reserveEmailQuota = vi.fn();
vi.mock("@/lib/email/quota", () => ({
  reserveEmailQuota: (...args: unknown[]) => reserveEmailQuota(...args),
}));

const sendServingConfirmationEmail = vi.fn();
const sendServingCancelNoticeEmail = vi.fn();
vi.mock("@/lib/email/serving", () => ({
  sendServingConfirmationEmail: (...args: unknown[]) => sendServingConfirmationEmail(...args),
  sendServingCancelNoticeEmail: (...args: unknown[]) => sendServingCancelNoticeEmail(...args),
}));

vi.mock("@/lib/ics-utils", () => ({
  generateServingICS: () => "BEGIN:VCALENDAR...",
}));

const { sendSignupConfirmation, notifyLeadersOfCancel } = await import(
  "@/lib/serving/server"
);

const BRANDING = {
  orgName: "Grace Fellowship",
  replyTo: null,
  accent: "#B85C38",
  accentLight: "#c98a68",
  fromAddress: "noreply@grace.church",
  // Distinctive — never equals siteConfig.url, so a call site that reverts
  // to the platform default fails loud.
  baseUrl: "https://grace.church",
};

// A chainable query-builder stub, matching the shape used elsewhere
// (app/api/serving/broadcast/route.test.ts) for the supabase/service client
// parameter these functions accept but don't need real data from here.
function chain(terminal: { data: unknown; error: unknown }) {
  const obj = {
    select: () => obj,
    eq: () => obj,
    in: () => obj,
    neq: () => obj,
    limit: () => obj,
    single: async () => terminal,
    maybeSingle: async () => terminal,
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(terminal).then(resolve, reject),
  };
  return obj;
}

function stubClient(rows: Record<string, { data: unknown; error: unknown }> = {}) {
  return {
    from: (table: string) => chain(rows[table] ?? { data: null, error: null }),
  } as never;
}

beforeEach(() => {
  resolveEmailBranding.mockReset().mockResolvedValue(BRANDING);
  orgBaseUrl.mockReset().mockResolvedValue("https://grace.church");
  getServingLinkMode.mockReset();
  createServingToken.mockReset().mockReturnValue("signed-token");
  reserveEmailQuota.mockReset().mockResolvedValue(true);
  sendServingConfirmationEmail.mockReset();
  sendServingCancelNoticeEmail.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("sendSignupConfirmation", () => {
  const baseOpts = {
    signupId: "signup-1",
    orgId: "org-1",
    groupId: "group-1",
    groupName: "Greeters",
    serviceDate: "2026-09-13",
    attendees: [],
    familyId: null,
    recipient: { id: "member-1", email: "sam@example.com", name: "Sam" },
  };

  it("builds cancelUrl from orgBaseUrl(opts.orgId), not siteConfig.url, in signed mode", async () => {
    getServingLinkMode.mockResolvedValue("signed");

    await sendSignupConfirmation(stubClient(), baseOpts);

    expect(orgBaseUrl).toHaveBeenCalledWith("org-1");
    expect(resolveEmailBranding).toHaveBeenCalledWith("org-1");
    const call = sendServingConfirmationEmail.mock.calls[0][0];
    expect(call.cancelUrl).toMatch(/^https:\/\/grace\.church\/serving\/go\?token=/);
  });

  it("builds cancelUrl from orgBaseUrl(opts.orgId) in login mode", async () => {
    getServingLinkMode.mockResolvedValue("login");

    await sendSignupConfirmation(stubClient(), baseOpts);

    const call = sendServingConfirmationEmail.mock.calls[0][0];
    expect(call.cancelUrl).toBe("https://grace.church/serving/group-1");
  });
});

describe("notifyLeadersOfCancel", () => {
  const baseOpts = {
    groupId: "group-1",
    orgId: "org-1",
    groupName: "Greeters",
    serviceDate: "2026-09-13",
    memberLabel: "Sam",
  };

  it("builds servingUrl from orgBaseUrl(opts.orgId), not siteConfig.url", async () => {
    const service = stubClient({
      profile_groups: {
        data: [
          {
            profiles: {
              id: "leader-1",
              first_name: "Leah",
              last_name: "Doe",
              preferred_name: null,
              email: "leah@example.com",
            },
          },
        ],
        error: null,
      },
    });

    await notifyLeadersOfCancel(service, baseOpts);

    expect(orgBaseUrl).toHaveBeenCalledWith("org-1");
    expect(resolveEmailBranding).toHaveBeenCalledWith("org-1");
    const call = sendServingCancelNoticeEmail.mock.calls[0][0];
    expect(call.servingUrl).toBe("https://grace.church/serving/group-1");
  });
});
