import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveGroup } from "@/lib/groups/active";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";

class GuardRefusal extends Error {}

const requireGroupSettingsLeader = vi.fn();
vi.mock("@/lib/groups/server", () => ({
  requireGroupSettingsLeader: (groupId: string) => requireGroupSettingsLeader(groupId),
}));

const getOrgTimeZone = vi.fn();
vi.mock("@/lib/time/orgZone", () => ({ getOrgTimeZone: () => getOrgTimeZone() }));

vi.mock("./InviteLinksManager", () => ({ InviteLinksManager: () => null }));

const { InviteLinksManager } = await import("./InviteLinksManager");
const { default: GroupInviteLinksSettingsPage } = await import("./page");

const A_ID = "11111111-1111-4111-8111-111111111111";
const leader: ActiveGroup = { id: A_ID, name: "Grace", color: GROUP_DEFAULT_COLOR, role: "leader" };

beforeEach(() => {
  requireGroupSettingsLeader.mockReset();
  getOrgTimeZone.mockReset();
  getOrgTimeZone.mockResolvedValue("America/Chicago");
});

describe("GroupInviteLinksSettingsPage", () => {
  it("does not render for a member who does not lead the group", async () => {
    requireGroupSettingsLeader.mockRejectedValue(new GuardRefusal("sent to Home"));

    await expect(
      GroupInviteLinksSettingsPage({ params: Promise.resolve({ groupId: A_ID }) }),
    ).rejects.toBeInstanceOf(GuardRefusal);
    expect(requireGroupSettingsLeader).toHaveBeenCalledWith(A_ID);
  });

  it("renders the manager for the group the viewer leads", async () => {
    requireGroupSettingsLeader.mockResolvedValue(leader);

    const element = await GroupInviteLinksSettingsPage({ params: Promise.resolve({ groupId: A_ID }) });

    expect(element.type).toBe(InviteLinksManager);
    expect(element.props).toEqual({ groupId: A_ID, groupName: "Grace", timeZone: "America/Chicago" });
  });
});
