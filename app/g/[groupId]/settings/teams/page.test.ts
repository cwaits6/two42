import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
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
vi.mock("@/lib/supabase/current-user", () => ({ getOptionalUser: async () => ({ id: "me" }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { org_id: "o1" }, error: null }) }) }),
    }),
  }),
}));
let settings: Promise<unknown>;
vi.mock("@/lib/groups/settings", () => ({ getGroupSettings: () => settings }));
vi.mock("@/lib/time/orgZone", () => ({ getOrgTimeZone: async () => "America/New_York" }));
vi.mock("./TeamsManager", () => ({ TeamsManager: () => null }));
vi.mock("./ServingLinkModeForm", () => ({ ServingLinkModeForm: () => null }));
vi.mock("./ServingStats", () => ({ ServingStats: () => null }));

const { ErrorState } = await import("@/components/states/ErrorState");
const { TeamsManager } = await import("./TeamsManager");
const { ServingLinkModeForm } = await import("./ServingLinkModeForm");
const { ServingStats } = await import("./ServingStats");
const { default: GroupTeamsSettingsPage } = await import("./page");

const A_ID = "11111111-1111-4111-8111-111111111111";
const leader: ActiveGroup = { id: A_ID, name: "Grace", color: GROUP_DEFAULT_COLOR, role: "leader" };
type Element = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;

function flatten(node: ReactNode, out: Element[] = []): Element[] {
  if (Array.isArray(node)) {
    node.forEach((n) => flatten(n, out));
    return out;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return out;
  const element = node as Element;
  out.push(element);
  flatten(element.props.children, out);
  return out;
}

const render = async () => (await GroupTeamsSettingsPage({ params: Promise.resolve({ groupId: A_ID }) })) as Element;

beforeEach(() => {
  requireGroupSettingsLeader.mockReset();
  requireGroupSettingsLeader.mockResolvedValue(leader);
  settings = Promise.resolve({ serving_link_mode: "login" });
});

describe("GroupTeamsSettingsPage", () => {
  it("does not render for a member who does not lead the group", async () => {
    requireGroupSettingsLeader.mockRejectedValue(new RedirectSentinel(`/g/${A_ID}/dashboard`));
    await expect(render()).rejects.toMatchObject({ target: `/g/${A_ID}/dashboard` });
    expect(requireGroupSettingsLeader).toHaveBeenCalledWith(A_ID);
  });

  it("holds the group's teams and its serving settings in one place", async () => {
    const element = await render();
    expect(element.type).toBe(TeamsManager);
    expect(element.props).toMatchObject({ groupId: A_ID, groupName: "Grace" });
    const nodes = flatten(element.props.children);
    expect(nodes.find((e) => e.type === ServingLinkModeForm)?.props).toEqual({ groupId: A_ID, initialMode: "login" });
    expect(nodes.find((e) => e.type === ServingStats)?.props).toMatchObject({ groupId: A_ID });
  });

  it("keeps the teams and says so when the serving setting can't be read", async () => {
    settings = Promise.reject(new Error("boom"));
    const element = await render();
    const nodes = flatten(element.props.children);
    expect(nodes.some((e) => e.type === ServingLinkModeForm)).toBe(false);
    expect(nodes.find((e) => e.type === ErrorState)?.props.thing).toBe("the serving email setting");
    expect(nodes.some((e) => e.type === ServingStats)).toBe(true);
  });
});
