import { beforeEach, describe, expect, it, vi } from "vitest";
import { GROUP_DEFAULT_COLOR, type ActiveGroup } from "@/lib/groups/active";

const cookieGet = vi.fn<(name: string) => { value: string } | undefined>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => cookieGet(name) }),
}));

class NotFoundSentinel extends Error {}
class RedirectSentinel extends Error {
  constructor(public readonly target: string) {
    super(`redirect:${target}`);
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFoundSentinel("not-found");
  },
  redirect: (target: string) => {
    throw new RedirectSentinel(target);
  },
}));

const profileResult = vi.fn();
const createClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient(),
}));

const getOptionalUser = vi.fn();
vi.mock("@/lib/supabase/current-user", () => ({
  getOptionalUser: () => getOptionalUser(),
}));

const loadGroupMemberships = vi.fn();
vi.mock("@/lib/groups/memberships", () => ({
  loadGroupMemberships: (...args: unknown[]) => loadGroupMemberships(...args),
}));

const { getActiveGroup, getGroupMemberships, requireActiveGroup, requireGroupLeader } =
  await import("@/lib/groups/server");

const A_ID = "11111111-1111-4111-8111-111111111111";
const B_ID = "22222222-2222-4222-8222-222222222222";
const Z_ID = "99999999-9999-4999-8999-999999999999";

const group = (id: string, role: ActiveGroup["role"] = "member"): ActiveGroup => ({
  id,
  name: "G",
  color: GROUP_DEFAULT_COLOR,
  role,
});
const A = group(A_ID, "leader");
const B = group(B_ID);

const stubClient = {
  from: () => ({
    select: () => ({
      eq: () => ({
        maybeSingle: () => profileResult(),
      }),
    }),
  }),
};

beforeEach(() => {
  cookieGet.mockReset();
  createClient.mockReset();
  createClient.mockResolvedValue(stubClient);
  profileResult.mockReset();
  profileResult.mockResolvedValue({ data: { org_id: "org-1", role: "member" }, error: null });
  getOptionalUser.mockReset();
  getOptionalUser.mockResolvedValue({ id: "user-1" });
  loadGroupMemberships.mockReset();
  loadGroupMemberships.mockResolvedValue([A, B]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getGroupMemberships", () => {
  it("loads memberships scoped to the viewer's own profile org", async () => {
    const result = await getGroupMemberships();

    expect(result).toEqual([A, B]);
    expect(loadGroupMemberships).toHaveBeenCalledWith(stubClient, {
      profileId: "user-1",
      orgId: "org-1",
    });
  });

  it("returns no groups for an anonymous request without building a client", async () => {
    getOptionalUser.mockResolvedValue(null);

    expect(await getGroupMemberships()).toEqual([]);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("throws when the profile read fails instead of reporting no groups", async () => {
    profileResult.mockResolvedValue({ data: null, error: { message: "boom" } });

    await expect(getGroupMemberships()).rejects.toThrow("boom");
    expect(loadGroupMemberships).not.toHaveBeenCalled();
  });

  it("returns no groups for a pending profile", async () => {
    profileResult.mockResolvedValue({ data: { org_id: "org-1", role: "pending" }, error: null });

    expect(await getGroupMemberships()).toEqual([]);
    expect(loadGroupMemberships).not.toHaveBeenCalled();
  });
});

describe("getActiveGroup", () => {
  it("prefers the cookie's group when the viewer is in it", async () => {
    cookieGet.mockReturnValue({ value: B_ID });

    expect(await getActiveGroup()).toBe(B);
    expect(cookieGet).toHaveBeenCalledWith("two42-group");
  });

  it("ignores a cookie naming a group the viewer is not in", async () => {
    cookieGet.mockReturnValue({ value: Z_ID });

    expect(await getActiveGroup()).toBe(A);
  });

  it("resolves null with no memberships", async () => {
    loadGroupMemberships.mockResolvedValue([]);

    expect(await getActiveGroup()).toBeNull();
  });
});

describe("requireActiveGroup", () => {
  it("404s a malformed id before building any client", async () => {
    await expect(requireActiveGroup("not-a-uuid")).rejects.toBeInstanceOf(NotFoundSentinel);
    expect(createClient).not.toHaveBeenCalled();
    expect(getOptionalUser).not.toHaveBeenCalled();
  });

  it("404s, never redirects, a signed-in viewer who is not a member", async () => {
    loadGroupMemberships.mockResolvedValue([A]);

    await expect(requireActiveGroup(B_ID)).rejects.toBeInstanceOf(NotFoundSentinel);
  });

  it("resolves the loader's row for a member", async () => {
    expect(await requireActiveGroup(B_ID)).toBe(B);
  });

  it("redirects an anonymous request to login", async () => {
    getOptionalUser.mockResolvedValue(null);

    await expect(requireActiveGroup(A_ID)).rejects.toMatchObject({ target: "/login" });
  });
});

describe("requireGroupLeader", () => {
  it("returns the group for a leader", async () => {
    expect(await requireGroupLeader(A_ID)).toBe(A);
  });

  it("404s a member who does not lead the group", async () => {
    await expect(requireGroupLeader(B_ID)).rejects.toBeInstanceOf(NotFoundSentinel);
  });
});
