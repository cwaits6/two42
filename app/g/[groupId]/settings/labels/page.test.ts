import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveGroup } from "@/lib/groups/active";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";

class GuardRefusal extends Error {}

const requireGroupSettingsLeader = vi.fn();
vi.mock("@/lib/groups/server", () => ({
  requireGroupSettingsLeader: (groupId: string) => requireGroupSettingsLeader(groupId),
}));

vi.mock("./LabelsManager", () => ({ LabelsManager: () => null }));

const { LabelsManager } = await import("./LabelsManager");
const { default: GroupLabelsSettingsPage } = await import("./page");

const A_ID = "11111111-1111-4111-8111-111111111111";
const leader: ActiveGroup = { id: A_ID, name: "Grace", color: GROUP_DEFAULT_COLOR, role: "leader" };

beforeEach(() => {
  requireGroupSettingsLeader.mockReset();
});

describe("GroupLabelsSettingsPage", () => {
  it("does not render for a member who does not lead the group", async () => {
    requireGroupSettingsLeader.mockRejectedValue(new GuardRefusal("sent to Home"));

    await expect(
      GroupLabelsSettingsPage({ params: Promise.resolve({ groupId: A_ID }) }),
    ).rejects.toBeInstanceOf(GuardRefusal);
    expect(requireGroupSettingsLeader).toHaveBeenCalledWith(A_ID);
  });

  it("renders the manager for the resolved group when the viewer leads it", async () => {
    requireGroupSettingsLeader.mockResolvedValue(leader);

    const element = await GroupLabelsSettingsPage({ params: Promise.resolve({ groupId: A_ID }) });

    expect(element.type).toBe(LabelsManager);
    expect(element.props).toEqual({ groupId: A_ID, groupName: "Grace" });
  });
});
