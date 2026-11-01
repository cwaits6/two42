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

vi.mock("@/lib/supabase/current-user", () => ({
  getOptionalUser: async () => ({ id: "user-1", email: undefined }),
}));

const ORG_ID = "22222222-2222-4222-8222-222222222222";
let profileRead: { data: { org_id: string } | null; error: { code: string } | null };
let countRead: { count: number | null; error: { code: string } | null };
let countFilters: [string, unknown][];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => {
          if (table === "group_join_requests") countFilters.push([column, value]);
          return chain;
        },
        maybeSingle: async () => profileRead,
        then: (resolve: (value: unknown) => void) => resolve(countRead),
      };
      return chain;
    },
  }),
}));

const { default: GroupSettingsPage } = await import("./page");

const A_ID = "11111111-1111-4111-8111-111111111111";
const leader: ActiveGroup = { id: A_ID, name: "Grace", color: GROUP_DEFAULT_COLOR, role: "leader" };
const member: ActiveGroup = { ...leader, role: "member" };

function texts(node: ReactNode, out: string[] = []): string[] {
  if (typeof node === "string") {
    out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((n) => texts(n, out));
    return out;
  }
  if (!node || typeof node !== "object" || !("props" in node)) return out;
  texts((node as ReactElement<{ children?: ReactNode }>).props.children, out);
  return out;
}

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
  profileRead = { data: { org_id: ORG_ID }, error: null };
  countRead = { count: 0, error: null };
  countFilters = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
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
      `/g/${A_ID}/settings/details`,
      `/g/${A_ID}/settings/about`,
      `/g/${A_ID}/settings/privacy`,
      `/g/${A_ID}/settings/invites`,
      `/g/${A_ID}/settings/announcements`,
      `/g/${A_ID}/settings/lectures`,
      `/g/${A_ID}/settings/giving`,
      `/g/${A_ID}/settings/serving`,
      `/g/${A_ID}/settings/teams`,
      `/g/${A_ID}/settings/labels`,
    ]);
  });

  async function renderHub() {
    requireActiveGroup.mockResolvedValue(leader);
    return texts(await GroupSettingsPage({ params: Promise.resolve({ groupId: A_ID }) }));
  }

  it("shows the count of this group's pending requests, read for this group and org", async () => {
    countRead = { count: 2, error: null };

    expect(await renderHub()).toContain("2 pending requests");
    expect(countFilters).toEqual([
      ["org_id", ORG_ID],
      ["group_id", A_ID],
      ["status", "pending"],
    ]);
  });

  it("uses the singular for one pending request", async () => {
    countRead = { count: 1, error: null };

    expect(await renderHub()).toContain("1 pending request");
  });

  it("shows no count when nothing is pending", async () => {
    expect((await renderHub()).join(" ")).not.toContain("pending request");
  });

  it("still renders the hub, with no count, when the count read fails", async () => {
    countRead = { count: null, error: { code: "57014" } };

    const rendered = await renderHub();
    expect(rendered).toContain("Privacy and joining");
    expect(rendered.join(" ")).not.toContain("pending request");
  });

  it("still renders the hub, with no count, when the org cannot be read", async () => {
    profileRead = { data: null, error: { code: "57014" } };

    const rendered = await renderHub();
    expect(rendered).toContain("Privacy and joining");
    expect(countFilters).toEqual([]);
  });

  it("does not say what role the viewer has", async () => {
    expect((await renderHub()).join(" ")).not.toContain("Your role");
  });
});
