// Narrow smoke test for the link origin in sendSignupConfirmation() and
// notifyLeadersOfCancel(): both build cancelUrl/servingUrl on the app's one
// canonical origin, with branding resolved for opts.orgId. This mocks every
// collaborator (same mock-the-collaborator shape as
// lib/email/resend.test.ts) and asserts only that — not the file's broader
// behavior (quota reservation, resolveCanSign interaction).

import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveEmailBranding = vi.fn();
vi.mock("@/lib/email/identity", () => ({
  resolveEmailBranding: (...args: unknown[]) => resolveEmailBranding(...args),
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return { siteConfig: { ...actual.siteConfig, url: "https://two42.io" } };
});

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
  getServingLinkMode.mockReset();
  createServingToken.mockReset().mockReturnValue("signed-token");
  reserveEmailQuota.mockReset().mockResolvedValue(true);
  sendServingConfirmationEmail.mockReset();
  sendServingCancelNoticeEmail.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("sendSignupConfirmation", () => {
  const baseOpts = {
    signupId: "signup-1",
    orgId: "org-1",
    groupId: "group-1",
    teamId: "team-1",
    teamName: "Greeters",
    serviceDate: "2026-09-13",
    attendees: [],
    familyId: null,
    recipient: { id: "member-1", email: "sam@example.com", name: "Sam" },
  };

  it("builds cancelUrl on the canonical origin in signed mode", async () => {
    getServingLinkMode.mockResolvedValue("signed");

    await sendSignupConfirmation(stubClient(), baseOpts);

    expect(resolveEmailBranding).toHaveBeenCalledWith("org-1");
    expect(getServingLinkMode).toHaveBeenCalledWith(expect.anything(), "org-1", "group-1");
    const call = sendServingConfirmationEmail.mock.calls[0][0];
    expect(call.cancelUrl).toMatch(/^https:\/\/two42\.io\/serving\/go\?token=/);
    expect(createServingToken).toHaveBeenCalledWith(
      expect.objectContaining({ a: "cancel", g: "team-1", p: "member-1" })
    );
  });

  it("builds cancelUrl on the canonical origin in login mode", async () => {
    getServingLinkMode.mockResolvedValue("login");

    await sendSignupConfirmation(stubClient(), baseOpts);

    const call = sendServingConfirmationEmail.mock.calls[0][0];
    expect(call.cancelUrl).toBe("https://two42.io/g/group-1/serving/team-1");
  });
});

describe("notifyLeadersOfCancel", () => {
  const baseOpts = {
    groupId: "group-1",
    teamId: "team-1",
    orgId: "org-1",
    teamName: "Greeters",
    serviceDates: ["2026-09-13"],
    memberLabel: "Sam",
  };

  it("builds servingUrl on the canonical origin", async () => {
    const service = stubClient({
      team_members: {
        data: [
          {
            profiles: {
              id: "leader-1",
              first_name: "Leah",
              last_name: "Doe",
              preferred_name: null,
              email: "leah@example.com",
              role: "member",
            },
          },
        ],
        error: null,
      },
    });

    await notifyLeadersOfCancel(service, baseOpts);

    expect(resolveEmailBranding).toHaveBeenCalledWith("org-1");
    const call = sendServingCancelNoticeEmail.mock.calls[0][0];
    expect(call.servingUrl).toBe("https://two42.io/g/group-1/serving/team-1");
  });

  it("skips a team lead who has been moved back to pending", async () => {
    const service = stubClient({
      team_members: {
        data: [
          {
            profiles: {
              id: "leader-1",
              first_name: "Leah",
              last_name: "Doe",
              preferred_name: null,
              email: "leah@example.com",
              role: "pending",
            },
          },
        ],
        error: null,
      },
    });

    await notifyLeadersOfCancel(service, baseOpts);

    expect(sendServingCancelNoticeEmail).not.toHaveBeenCalled();
  });

  const leader = {
    profiles: {
      id: "leader-1",
      first_name: "Leah",
      last_name: "Doe",
      preferred_name: null,
      email: "leah@example.com",
      role: "member",
    },
  };

  it("reads a team's leaders once for several dates, and sends one notice per date", async () => {
    const stub = stubClient({ team_members: { data: [leader], error: null } }) as unknown as {
      from: (table: string) => unknown;
    };
    const from = vi.fn(stub.from);

    await notifyLeadersOfCancel({ from } as never, {
      ...baseOpts,
      serviceDates: ["2026-09-13", "2026-09-20"],
    });

    expect(from.mock.calls.filter(([table]) => table === "team_members")).toHaveLength(1);
    expect(reserveEmailQuota).toHaveBeenCalledWith("org-1", 2);
    expect(sendServingCancelNoticeEmail.mock.calls.map(([call]) => call.serviceDate)).toEqual([
      "2026-09-13",
      "2026-09-20",
    ]);
  });

  it("greets a leader by first name, and by no name when there is none", async () => {
    const nameless = { profiles: { ...leader.profiles, id: "leader-2", first_name: null } };
    await notifyLeadersOfCancel(
      stubClient({ team_members: { data: [leader, nameless], error: null } }),
      baseOpts,
    );
    expect(sendServingCancelNoticeEmail.mock.calls.map(([call]) => call.leaderName)).toEqual(["Leah", null]);
  });

  it("logs a failed send without a name or address, and sends the next", async () => {
    const consoleError = vi.mocked(console.log);
    consoleError.mockClear();
    const service = stubClient({ team_members: { data: [leader, leader], error: null } });
    sendServingCancelNoticeEmail.mockRejectedValueOnce(new Error("Leah Doe <leah@example.com> bounced"));

    await notifyLeadersOfCancel(service, baseOpts);

    expect(sendServingCancelNoticeEmail).toHaveBeenCalledTimes(2);
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls.flat().map(String).join(" ")).not.toMatch(/Leah|example\.com/);
  });
});
