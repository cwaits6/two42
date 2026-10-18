import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { GROUP_DEFAULT_COLOR, type ActiveGroup } from "@/lib/groups/active";

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

const profileRole = vi.fn<() => string>();
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
          single: async () =>
            table === "profiles" ? { data: { role: profileRole() } } : { data: null },
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
  profileRole.mockReset();
  profileRole.mockReturnValue("member");
});

describe("GroupSettingsPage", () => {
  it("sends a member who does not lead the group to its dashboard", async () => {
    requireActiveGroup.mockResolvedValue(member);

    await expect(GroupSettingsPage({ params: Promise.resolve({ groupId: A_ID }) })).rejects.toMatchObject({
      target: `/g/${A_ID}/dashboard`,
    });
  });

  it("shows a leader who is not an org admin no admin links", async () => {
    requireActiveGroup.mockResolvedValue(leader);

    const element = await GroupSettingsPage({ params: Promise.resolve({ groupId: A_ID }) });

    expect(hrefs(element).filter((h) => h.startsWith("/admin/"))).toEqual([]);
  });

  it("shows an org admin the interim content links", async () => {
    requireActiveGroup.mockResolvedValue(leader);
    profileRole.mockReturnValue("admin");

    const element = await GroupSettingsPage({ params: Promise.resolve({ groupId: A_ID }) });

    expect(hrefs(element).filter((h) => h.startsWith("/admin/"))).toEqual([
      "/admin/events/new",
      "/admin/calendars",
      "/admin/serving",
      "/admin/lectures",
      "/admin/announcements/new",
      "/admin/about",
      "/admin/giving",
    ]);
  });
});
