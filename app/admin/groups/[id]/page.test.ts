import { beforeEach, describe, expect, it, vi } from "vitest";

const GROUP_ID = "11111111-1111-4111-8111-111111111111";

const { getGroupMemberships } = vi.hoisted(() => ({ getGroupMemberships: vi.fn() }));

vi.mock("@/lib/groups/server", () => ({ getGroupMemberships }));
vi.mock("@/lib/pageTitle", () => ({ pageTitle: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: GROUP_ID, name: "Group", description: null, group_members: [] },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

const { default: AdminGroupPage } = await import("./page");

describe("AdminGroupPage", () => {
  beforeEach(() => {
    getGroupMemberships.mockReset();
  });

  it("fails rather than telling a church admin they aren't in the group when memberships can't be read", async () => {
    getGroupMemberships.mockRejectedValue(new Error("down"));
    await expect(AdminGroupPage({ params: Promise.resolve({ id: GROUP_ID }) })).rejects.toThrow("down");
  });

  it("renders for a church admin outside the group", async () => {
    getGroupMemberships.mockResolvedValue([]);
    await expect(AdminGroupPage({ params: Promise.resolve({ id: GROUP_ID }) })).resolves.toBeTruthy();
  });
});
