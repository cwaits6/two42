import { beforeEach, describe, expect, it, vi } from "vitest";
import { GROUP_DEFAULT_COLOR, type ActiveGroup } from "@/lib/groups/active";

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

const getOptionalUser = vi.fn();
vi.mock("@/lib/supabase/current-user", () => ({
  getOptionalUser: () => getOptionalUser(),
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

const getGroupMemberships = vi.fn();
vi.mock("@/lib/groups/server", () => ({
  getGroupMemberships: () => getGroupMemberships(),
}));

const getDiscoveryOn = vi.fn();
vi.mock("@/lib/groups/discovery", () => ({
  getDiscoveryOn: () => getDiscoveryOn(),
}));

vi.mock("@/components/groups/GroupDashboard", () => ({ GroupDashboard: () => null }));
vi.mock("@/components/groups/HomeLauncher", () => ({ HomeLauncher: () => null }));
vi.mock("@/components/groups/NoGroupCard", () => ({ NoGroupCard: () => null }));

const { GroupDashboard } = await import("@/components/groups/GroupDashboard");
const { HomeLauncher } = await import("@/components/groups/HomeLauncher");
const { NoGroupCard } = await import("@/components/groups/NoGroupCard");
const { default: DashboardPage } = await import("./page");

const A: ActiveGroup = { id: "a", name: "Grace", color: GROUP_DEFAULT_COLOR, role: "leader" };
const B: ActiveGroup = { id: "b", name: "Hope", color: GROUP_DEFAULT_COLOR, role: "member" };

beforeEach(() => {
  getOptionalUser.mockReset();
  getOptionalUser.mockResolvedValue({ id: "user-1" });
  profileResult.mockReset();
  profileResult.mockResolvedValue({
    data: { role: "member", org_id: "org-1", preferred_name: null, first_name: "Ann" },
  });
  getGroupMemberships.mockReset();
  getDiscoveryOn.mockReset();
  getDiscoveryOn.mockResolvedValue(false);
});

describe("DashboardPage", () => {
  it("redirects an anonymous visitor to login", async () => {
    getOptionalUser.mockResolvedValue(null);

    await expect(DashboardPage()).rejects.toMatchObject({ target: "/login" });
  });

  it("renders the pending card for a pending profile without loading groups", async () => {
    profileResult.mockResolvedValue({ data: { role: "pending", org_id: "org-1" } });

    const element = await DashboardPage();

    expect(element.type).toBe("div");
    expect(getGroupMemberships).not.toHaveBeenCalled();
  });

  it("renders the no-group card with discovery forwarded", async () => {
    getGroupMemberships.mockResolvedValue([]);
    getDiscoveryOn.mockResolvedValue(true);

    const element = await DashboardPage();

    expect(element.type).toBe(NoGroupCard);
    expect(element.props).toEqual({ discoveryOn: true });
  });

  it("renders the group dashboard directly for a one-group member, with no launcher", async () => {
    getGroupMemberships.mockResolvedValue([A]);

    const element = await DashboardPage();

    expect(element.type).toBe(GroupDashboard);
    expect(element.props).toEqual({ group: A });
  });

  it("renders the launcher for a member of two or more groups", async () => {
    getGroupMemberships.mockResolvedValue([A, B]);

    const element = await DashboardPage();

    expect(element.type).toBe(HomeLauncher);
    expect(element.props).toEqual({
      memberships: [A, B],
      discoveryOn: false,
      displayName: "Ann",
      orgId: "org-1",
    });
  });
});
