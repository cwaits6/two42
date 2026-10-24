import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveGroup } from "@/lib/groups/active";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";

class NotFoundSentinel extends Error {}

const requireGroupLeader = vi.fn();
vi.mock("@/lib/groups/server", () => ({
  requireGroupLeader: (groupId: string) => requireGroupLeader(groupId),
}));

const getDiscoveryOn = vi.fn();
vi.mock("@/lib/groups/discovery", () => ({
  getDiscoveryOn: () => getDiscoveryOn(),
}));

const groupFlags = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: groupFlags() }),
        }),
      }),
    }),
  }),
}));

vi.mock("./PrivacyAndJoiningManager", () => ({ PrivacyAndJoiningManager: () => null }));

const { PrivacyAndJoiningManager } = await import("./PrivacyAndJoiningManager");
const { default: GroupPrivacySettingsPage } = await import("./page");

const A_ID = "11111111-1111-4111-8111-111111111111";
const leader: ActiveGroup = { id: A_ID, name: "Grace", color: GROUP_DEFAULT_COLOR, role: "leader" };

beforeEach(() => {
  requireGroupLeader.mockReset();
  getDiscoveryOn.mockReset();
  groupFlags.mockReset();
});

describe("GroupPrivacySettingsPage", () => {
  it("does not render for a member who does not lead the group", async () => {
    requireGroupLeader.mockRejectedValue(new NotFoundSentinel("not found"));

    await expect(
      GroupPrivacySettingsPage({ params: Promise.resolve({ groupId: A_ID }) }),
    ).rejects.toBeInstanceOf(NotFoundSentinel);
    expect(requireGroupLeader).toHaveBeenCalledWith(A_ID);
  });

  it("renders the manager with the group's flags and the org switch when the viewer leads it", async () => {
    requireGroupLeader.mockResolvedValue(leader);
    getDiscoveryOn.mockResolvedValue(true);
    groupFlags.mockReturnValue({ is_private: true, join_policy: "open" });

    const element = await GroupPrivacySettingsPage({ params: Promise.resolve({ groupId: A_ID }) });

    expect(element.type).toBe(PrivacyAndJoiningManager);
    expect(element.props).toEqual({
      groupId: A_ID,
      groupName: "Grace",
      initialPrivate: true,
      initialPolicy: "open",
      orgDiscoveryOn: true,
    });
  });

  it("falls back to public and approval when the flags read returns nothing", async () => {
    requireGroupLeader.mockResolvedValue(leader);
    getDiscoveryOn.mockResolvedValue(false);
    groupFlags.mockReturnValue(null);

    const element = await GroupPrivacySettingsPage({ params: Promise.resolve({ groupId: A_ID }) });

    expect(element.props).toMatchObject({
      initialPrivate: false,
      initialPolicy: "approval",
      orgDiscoveryOn: false,
    });
  });
});
