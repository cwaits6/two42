import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveGroup } from "@/lib/groups/active";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";

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
vi.mock("@/components/states/ErrorState", () => ({ ErrorState: () => null }));
vi.mock("./SignOutButton", () => ({ SignOutButton: () => null }));

const { GroupDashboard } = await import("@/components/groups/GroupDashboard");
const { HomeLauncher } = await import("@/components/groups/HomeLauncher");
const { NoGroupCard } = await import("@/components/groups/NoGroupCard");
const { ErrorState } = await import("@/components/states/ErrorState");
const { SignOutButton } = await import("./SignOutButton");
const { default: DashboardPage } = await import("./page");

function childTypes(element: { props: { children?: unknown } }): unknown[] {
  const children = element.props.children;
  return (Array.isArray(children) ? children : [children]).map(
    (child) => (child as { type?: unknown } | null)?.type
  );
}

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

  it("tells a pending profile who reviews it and offers Sign out, without loading groups", async () => {
    profileResult.mockResolvedValue({ data: { role: "pending", org_id: "org-1" }, error: null });

    const element = await DashboardPage();

    const [header] = (element.props as { children: { props: { title: string; subtitle: string } }[] })
      .children;
    expect(header.props.title).toBe("Waiting for approval");
    expect(header.props.subtitle).toContain("A church admin reviews your account.");
    expect(childTypes(element)).toContain(SignOutButton);
    expect(getGroupMemberships).not.toHaveBeenCalled();
  });

  it("shows the failed read, not the pending page, when the profile read errors", async () => {
    profileResult.mockResolvedValue({ data: null, error: { code: "57014", message: "timeout" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const element = await DashboardPage();

    expect(childTypes(element)).toContain(ErrorState);
    expect(getGroupMemberships).not.toHaveBeenCalled();
  });

  it("treats a missing profile as pending", async () => {
    profileResult.mockResolvedValue({ data: null, error: { code: "PGRST116", message: "no rows" } });

    const element = await DashboardPage();

    expect(childTypes(element)).toContain(SignOutButton);
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

  it("passes no stand-in name to the launcher when the profile has none", async () => {
    getGroupMemberships.mockResolvedValue([A, B]);
    profileResult.mockResolvedValue({
      data: { role: "member", org_id: "org-1", preferred_name: null, first_name: null },
    });

    const element = await DashboardPage();

    expect(element.props.displayName).toBeNull();
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
