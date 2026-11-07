import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { ActiveGroup } from "@/lib/groups/active";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";
import { NO_PENDING_TEXT, OPEN_POLICY_EMPTY_TEXT } from "@/lib/groups/joining";

class GuardRefusal extends Error {}

const requireGroupSettingsLeader = vi.fn();
vi.mock("@/lib/groups/server", () => ({
  requireGroupSettingsLeader: (groupId: string) => requireGroupSettingsLeader(groupId),
}));
vi.mock("@/lib/time/orgZone", () => ({ getOrgTimeZone: async () => "America/Chicago" }));

const policyRead = vi.fn();
const filters: [string, unknown][] = [];
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return { maybeSingle: async () => policyRead() };
        },
      }),
    }),
  }),
}));
vi.mock("./JoinRequestsManager", () => ({ JoinRequestsManager: () => null }));

const { JoinRequestsManager } = await import("./JoinRequestsManager");
const { default: GroupRequestsSettingsPage } = await import("./page");

const A_ID = "11111111-1111-4111-8111-111111111111";
const leader: ActiveGroup = { id: A_ID, name: "Grace", color: GROUP_DEFAULT_COLOR, role: "leader" };
type Element = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;

function manager(node: ReactNode): Element | undefined {
  if (Array.isArray(node)) return node.map(manager).find(Boolean);
  if (!node || typeof node !== "object" || !("props" in node)) return undefined;
  const element = node as Element;
  return element.type === JoinRequestsManager ? element : manager(element.props.children);
}

const render = async () => manager(await GroupRequestsSettingsPage({ params: Promise.resolve({ groupId: A_ID }) }));

beforeEach(() => {
  requireGroupSettingsLeader.mockReset();
  requireGroupSettingsLeader.mockResolvedValue(leader);
  policyRead.mockReset();
  filters.length = 0;
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("GroupRequestsSettingsPage", () => {
  it("does not render for a member who does not lead the group", async () => {
    requireGroupSettingsLeader.mockRejectedValue(new GuardRefusal("sent to Home"));
    await expect(render()).rejects.toBeInstanceOf(GuardRefusal);
    expect(requireGroupSettingsLeader).toHaveBeenCalledWith(A_ID);
  });

  it("lists this group's requests, worded for its join policy", async () => {
    policyRead.mockResolvedValue({ data: { join_policy: "open" }, error: null });
    expect((await render())?.props).toEqual({
      groupId: A_ID,
      groupName: "Grace",
      emptyText: OPEN_POLICY_EMPTY_TEXT,
      timeZone: "America/Chicago",
    });
    expect(filters).toEqual([["id", A_ID]]);
  });

  it("still lists the requests when the join policy can't be read", async () => {
    policyRead.mockResolvedValue({ data: null, error: { code: "57014", message: "canceled" } });
    expect((await render())?.props.emptyText).toBe(NO_PENDING_TEXT);
  });
});
