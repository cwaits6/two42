import { beforeEach, describe, expect, it, vi } from "vitest";

class RedirectSentinel extends Error {
  constructor(public readonly target: string) {
    super(`redirect:${target}`);
  }
}
vi.mock("next/navigation", () => ({
  redirect: (target: string) => {
    throw new RedirectSentinel(target);
  },
}));

vi.mock("@/lib/supabase/current-user", () => ({
  getOptionalUser: async () => ({ id: "user-1", email: "person@example.com" }),
}));

const profileResult = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => profileResult(),
        }),
      }),
    }),
  }),
}));

const getPlatformAdmin = vi.fn();
vi.mock("@/lib/platform-access", () => ({
  getPlatformAdmin: () => getPlatformAdmin(),
}));

vi.mock("./DisplayCard", () => ({ DisplayCard: () => null }));
vi.mock("./SignInSecurityCard", () => ({ SignInSecurityCard: () => null }));
vi.mock("./NotificationsCard", () => ({ NotificationsCard: () => null }));
vi.mock("./FeedbackCard", () => ({ FeedbackCard: () => null }));
vi.mock("./YourDataCard", () => ({ YourDataCard: () => null }));

const { SignInSecurityCard } = await import("./SignInSecurityCard");
const { NotificationsCard } = await import("./NotificationsCard");
const { YourDataCard } = await import("./YourDataCard");
const { default: SettingsPage } = await import("./page");

type Node = { type?: unknown; props?: { children?: unknown } } | null | undefined | false;

/** Every element type in the rendered tree, without calling the components. */
function typesIn(node: unknown, found: unknown[] = []): unknown[] {
  if (Array.isArray(node)) {
    for (const child of node) typesIn(child, found);
    return found;
  }
  const element = node as Node;
  if (!element || typeof element !== "object") return found;
  found.push(element.type);
  return typesIn(element.props?.children, found);
}

const NO_PROFILE = { data: null, error: { code: "PGRST116", message: "no rows" } };

beforeEach(() => {
  profileResult.mockReset();
  getPlatformAdmin.mockReset();
  getPlatformAdmin.mockResolvedValue(null);
});

describe("SettingsPage", () => {
  it("shows a member every card without asking the operator gate", async () => {
    profileResult.mockResolvedValue({
      data: { role: "member", email_announcements: true, email_event_reminders: false },
      error: null,
    });

    const types = typesIn(await SettingsPage());

    expect(types).toContain(SignInSecurityCard);
    expect(types).toContain(NotificationsCard);
    expect(types).toContain(YourDataCard);
    expect(getPlatformAdmin).not.toHaveBeenCalled();
  });

  it("shows an operator with no profile the sign-in card, and no card that needs a profile", async () => {
    profileResult.mockResolvedValue(NO_PROFILE);
    getPlatformAdmin.mockResolvedValue({ id: "user-1" });

    const types = typesIn(await SettingsPage());

    expect(types).toContain(SignInSecurityCard);
    expect(types).not.toContain(NotificationsCard);
    expect(types).not.toContain(YourDataCard);
  });

  it("sends a person with no profile who is not an operator to Home", async () => {
    profileResult.mockResolvedValue(NO_PROFILE);

    await expect(SettingsPage()).rejects.toMatchObject({ target: "/dashboard" });
  });

  it("sends a pending person to Home even when they are an operator", async () => {
    profileResult.mockResolvedValue({ data: { role: "pending" }, error: null });
    getPlatformAdmin.mockResolvedValue({ id: "user-1" });

    await expect(SettingsPage()).rejects.toMatchObject({ target: "/dashboard" });
  });

  it("does not treat a failed profile read as a missing profile", async () => {
    profileResult.mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } });
    getPlatformAdmin.mockResolvedValue({ id: "user-1" });

    await expect(SettingsPage()).rejects.toMatchObject({ target: "/dashboard" });
    expect(getPlatformAdmin).not.toHaveBeenCalled();
  });
});
