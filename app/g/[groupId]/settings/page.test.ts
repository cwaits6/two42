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

const requireActiveGroup = vi.fn();
const requireGroupSettingsAccess = vi.fn();
vi.mock("@/lib/groups/server", () => ({
  requireActiveGroup: (groupId: string) => requireActiveGroup(groupId),
  requireGroupSettingsAccess: (groupId: string, needs: string) => requireGroupSettingsAccess(groupId, needs),
}));

const { default: GroupSettingsPage } = await import("./page");
const { default: GroupServingSettingsPage } = await import("./serving/page");

const A_ID = "11111111-1111-4111-8111-111111111111";
const leader: ActiveGroup = { id: A_ID, name: "Grace", color: GROUP_DEFAULT_COLOR, role: "leader" };
const params = Promise.resolve({ groupId: A_ID });

beforeEach(() => {
  requireActiveGroup.mockReset();
  requireActiveGroup.mockResolvedValue(leader);
  requireGroupSettingsAccess.mockReset();
  requireGroupSettingsAccess.mockResolvedValue(leader);
});

describe("Group settings addresses", () => {
  it("opens Group settings on Details for a leader", async () => {
    await expect(GroupSettingsPage({ params })).rejects.toMatchObject({ target: `/g/${A_ID}/settings/details` });
    expect(requireActiveGroup).toHaveBeenCalledWith(A_ID);
  });

  it("opens Group settings on the first page a member's abilities reach", async () => {
    requireActiveGroup.mockResolvedValue({ ...leader, role: "member", abilities: ["teams"] });
    await expect(GroupSettingsPage({ params })).rejects.toMatchObject({ target: `/g/${A_ID}/settings/teams` });
  });

  it("sends a member with no abilities to the group's Home", async () => {
    requireActiveGroup.mockResolvedValue({ ...leader, role: "member" });
    await expect(GroupSettingsPage({ params })).rejects.toMatchObject({ target: `/g/${A_ID}/dashboard` });
  });

  it("sends the serving settings address to Teams, for whoever manages teams", async () => {
    await expect(GroupServingSettingsPage({ params })).rejects.toMatchObject({ target: `/g/${A_ID}/settings/teams` });
    expect(requireGroupSettingsAccess).toHaveBeenCalledWith(A_ID, "teams");
  });

  it("sends someone who cannot manage teams wherever the guard sends them", async () => {
    requireGroupSettingsAccess.mockRejectedValue(new RedirectSentinel(`/g/${A_ID}/dashboard`));
    await expect(GroupServingSettingsPage({ params })).rejects.toMatchObject({ target: `/g/${A_ID}/dashboard` });
  });
});
