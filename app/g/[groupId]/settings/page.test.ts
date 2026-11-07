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

const requireGroupSettingsLeader = vi.fn();
vi.mock("@/lib/groups/server", () => ({
  requireGroupSettingsLeader: (groupId: string) => requireGroupSettingsLeader(groupId),
}));

const { default: GroupSettingsPage } = await import("./page");
const { default: GroupServingSettingsPage } = await import("./serving/page");

const A_ID = "11111111-1111-4111-8111-111111111111";
const leader: ActiveGroup = { id: A_ID, name: "Grace", color: GROUP_DEFAULT_COLOR, role: "leader" };
const params = Promise.resolve({ groupId: A_ID });

beforeEach(() => {
  requireGroupSettingsLeader.mockReset();
  requireGroupSettingsLeader.mockResolvedValue(leader);
});

describe("old Group settings addresses", () => {
  it("opens Group settings on Details", async () => {
    await expect(GroupSettingsPage({ params })).rejects.toMatchObject({ target: `/g/${A_ID}/settings/details` });
    expect(requireGroupSettingsLeader).toHaveBeenCalledWith(A_ID);
  });

  it("sends the serving settings address to Teams", async () => {
    await expect(GroupServingSettingsPage({ params })).rejects.toMatchObject({ target: `/g/${A_ID}/settings/teams` });
    expect(requireGroupSettingsLeader).toHaveBeenCalledWith(A_ID);
  });

  it.each([
    ["Group settings", GroupSettingsPage],
    ["the serving settings", GroupServingSettingsPage],
  ])("sends a member who opens %s wherever the guard sends them", async (_name, Page) => {
    requireGroupSettingsLeader.mockRejectedValue(new RedirectSentinel(`/g/${A_ID}/dashboard`));
    await expect(Page({ params })).rejects.toMatchObject({ target: `/g/${A_ID}/dashboard` });
  });
});
