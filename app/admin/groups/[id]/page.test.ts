import { beforeEach, describe, expect, it, vi } from "vitest";

const GROUP_ID = "11111111-1111-4111-8111-111111111111";

const { getGroupMemberships, groupResult } = vi.hoisted(() => ({
  getGroupMemberships: vi.fn(),
  groupResult: vi.fn(),
}));

vi.mock("@/lib/groups/server", () => ({ getGroupMemberships }));
vi.mock("@/lib/pageTitle", () => ({ pageTitle: vi.fn() }));
vi.mock("@/components/states/ErrorState", () => ({ ErrorState: () => null }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: groupResult,
        }),
      }),
    }),
  }),
}));

const { ErrorState } = await import("@/components/states/ErrorState");
const { default: AdminGroupPage } = await import("./page");

describe("AdminGroupPage", () => {
  beforeEach(() => {
    getGroupMemberships.mockReset();
    groupResult.mockReset();
    groupResult.mockResolvedValue({
      data: { id: GROUP_ID, name: "Group", description: null, group_members: [] },
      error: null,
    });
  });

  it("shows the failed read, not a missing group, when the group can't be read", async () => {
    getGroupMemberships.mockResolvedValue([]);
    groupResult.mockResolvedValue({ data: null, error: { code: "57014" } });
    vi.spyOn(console, "error").mockImplementation(() => {});

    const element = await AdminGroupPage({ params: Promise.resolve({ id: GROUP_ID }) });

    const children = (element.props as { children: { type?: unknown }[] }).children;
    expect(children.map((child) => child.type)).toContain(ErrorState);
  });

  it("answers 404 for a group that does not exist", async () => {
    getGroupMemberships.mockResolvedValue([]);
    groupResult.mockResolvedValue({ data: null, error: null });

    await expect(AdminGroupPage({ params: Promise.resolve({ id: GROUP_ID }) })).rejects.toThrow();
  });

  it("shows the failed read rather than telling a church admin they aren't in the group when memberships can't be read", async () => {
    getGroupMemberships.mockRejectedValue(new Error("down"));

    const element = await AdminGroupPage({ params: Promise.resolve({ id: GROUP_ID }) });

    const children = (element.props as { children: { type?: unknown }[] }).children;
    expect(children.map((child) => child.type)).toContain(ErrorState);
  });

  it("renders for a church admin outside the group", async () => {
    getGroupMemberships.mockResolvedValue([]);
    await expect(AdminGroupPage({ params: Promise.resolve({ id: GROUP_ID }) })).resolves.toBeTruthy();
  });
});
