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

const requireActiveGroup = vi.fn();
vi.mock("@/lib/groups/server", () => ({
  requireActiveGroup: (groupId: string) => requireActiveGroup(groupId),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === "groups"
              ? { data: { name: "Grace", description: "Sunday class" } }
              : { data: null },
        }),
      }),
    }),
  }),
}));

vi.mock("@/components/groups/GroupDetailsForm", () => ({ GroupDetailsForm: () => null }));

const { default: GroupSettingsPage } = await import("./page");

const A_ID = "11111111-1111-4111-8111-111111111111";
const leader: ActiveGroup = { id: A_ID, name: "Grace", color: GROUP_DEFAULT_COLOR, role: "leader" };
const member: ActiveGroup = { ...leader, role: "member" };

function hrefs(node: ReactNode, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    node.forEach((n) => hrefs(n, out));
    return out;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return out;
  const element = node as ReactElement<{ href?: string; children?: ReactNode }>;
  if (typeof element.props.href === "string") out.push(element.props.href);
  hrefs(element.props.children, out);
  return out;
}

beforeEach(() => {
  requireActiveGroup.mockReset();
});

describe("GroupSettingsPage", () => {
  it("sends a member who does not lead the group to its dashboard", async () => {
    requireActiveGroup.mockResolvedValue(member);

    await expect(GroupSettingsPage({ params: Promise.resolve({ groupId: A_ID }) })).rejects.toMatchObject({
      target: `/g/${A_ID}/dashboard`,
    });
  });

  it("shows a leader the content tiles under the group and nothing under /admin", async () => {
    requireActiveGroup.mockResolvedValue(leader);

    const element = await GroupSettingsPage({ params: Promise.resolve({ groupId: A_ID }) });
    const links = hrefs(element);

    expect(links.filter((h) => h.startsWith("/admin"))).toEqual([]);
    expect(links).toEqual([
      `/g/${A_ID}/settings/about`,
      `/g/${A_ID}/settings/announcements`,
      `/g/${A_ID}/settings/lectures`,
      `/g/${A_ID}/settings/giving`,
      `/g/${A_ID}/settings/serving`,
      `/g/${A_ID}/settings/teams`,
      `/g/${A_ID}/settings/labels`,
    ]);
  });
});
