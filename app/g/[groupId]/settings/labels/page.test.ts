import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActiveGroup } from "@/lib/groups/active";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";

class NotFoundSentinel extends Error {}

const requireGroupLeader = vi.fn();
vi.mock("@/lib/groups/server", () => ({
  requireGroupLeader: (groupId: string) => requireGroupLeader(groupId),
}));

vi.mock("./LabelsManager", () => ({ LabelsManager: () => null }));

const { LabelsManager } = await import("./LabelsManager");
const { default: GroupLabelsSettingsPage } = await import("./page");

const A_ID = "11111111-1111-4111-8111-111111111111";
const leader: ActiveGroup = { id: A_ID, name: "Grace", color: GROUP_DEFAULT_COLOR, role: "leader" };

beforeEach(() => {
  requireGroupLeader.mockReset();
});

describe("GroupLabelsSettingsPage", () => {
  it("does not render for a member who does not lead the group", async () => {
    requireGroupLeader.mockRejectedValue(new NotFoundSentinel("not found"));

    await expect(
      GroupLabelsSettingsPage({ params: Promise.resolve({ groupId: A_ID }) }),
    ).rejects.toBeInstanceOf(NotFoundSentinel);
    expect(requireGroupLeader).toHaveBeenCalledWith(A_ID);
  });

  it("renders the manager for the resolved group when the viewer leads it", async () => {
    requireGroupLeader.mockResolvedValue(leader);

    const element = await GroupLabelsSettingsPage({ params: Promise.resolve({ groupId: A_ID }) });

    expect(element.type).toBe(LabelsManager);
    expect(element.props).toEqual({ groupId: A_ID, groupName: "Grace" });
  });
});
