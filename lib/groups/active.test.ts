import { describe, expect, it } from "vitest";
import {
  GROUP_DEFAULT_COLOR,
  groupIdFromPath,
  groupInitials,
  groupPath,
  isLegacyGroupPath,
  legacyRedirectTarget,
  resolveActiveGroup,
  swapGroupInPath,
  type ActiveGroup,
} from "@/lib/groups/active";

const A_ID = "11111111-1111-4111-8111-111111111111";
const B_ID = "22222222-2222-4222-8222-222222222222";
const Z_ID = "99999999-9999-4999-8999-999999999999";

const group = (id: string, role: ActiveGroup["role"] = "member"): ActiveGroup => ({
  id,
  name: `Group ${id.slice(0, 1)}`,
  color: GROUP_DEFAULT_COLOR,
  role,
});

const A = group(A_ID, "leader");
const B = group(B_ID);

describe("resolveActiveGroup", () => {
  it("URL beats cookie", () => {
    expect(
      resolveActiveGroup({ urlGroupId: A_ID, cookieGroupId: B_ID, memberships: [B, A] })
    ).toBe(A);
  });

  it("cookie beats first membership", () => {
    expect(resolveActiveGroup({ cookieGroupId: B_ID, memberships: [A, B] })).toBe(B);
  });

  it("ignores a cookie for a group the viewer is not in", () => {
    expect(resolveActiveGroup({ cookieGroupId: Z_ID, memberships: [A, B] })).toBe(A);
  });

  it("returns null for a URL id outside the memberships even with a valid cookie", () => {
    expect(
      resolveActiveGroup({ urlGroupId: Z_ID, cookieGroupId: A_ID, memberships: [A] })
    ).toBeNull();
  });

  it("resolves a one-group member to that group with no cookie and with a stale cookie", () => {
    expect(resolveActiveGroup({ memberships: [A] })).toBe(A);
    expect(resolveActiveGroup({ cookieGroupId: Z_ID, memberships: [A] })).toBe(A);
  });

  it("returns null in every branch when there are no memberships", () => {
    expect(resolveActiveGroup({ memberships: [] })).toBeNull();
    expect(resolveActiveGroup({ cookieGroupId: A_ID, memberships: [] })).toBeNull();
    expect(resolveActiveGroup({ urlGroupId: A_ID, memberships: [] })).toBeNull();
  });
});

describe("groupIdFromPath", () => {
  it("reads the id from a group page and from the bare prefix", () => {
    expect(groupIdFromPath(`/g/${A_ID}/calendar`)).toBe(A_ID);
    expect(groupIdFromPath(`/g/${A_ID}`)).toBe(A_ID);
  });

  it.each(["/give", "/grace/join", "/g/not-a-uuid/x", "/g", "/g/"])(
    "returns null for %s",
    (pathname) => expect(groupIdFromPath(pathname)).toBeNull()
  );
});

describe("groupPath", () => {
  it("joins with exactly one slash", () => {
    expect(groupPath(A_ID, "/calendar/1")).toBe(`/g/${A_ID}/calendar/1`);
    expect(groupPath(A_ID, "calendar")).toBe(`/g/${A_ID}/calendar`);
  });
});

describe("isLegacyGroupPath", () => {
  it.each([
    "/events",
    "/events/abc",
    "/announcements",
    "/announcements/1",
    "/lectures",
    "/lectures/series/x",
    "/about",
    "/serving",
    "/serving/team-1",
    "/prayer",
    "/give",
    "/give/new",
  ])("matches %s", (pathname) => expect(isLegacyGroupPath(pathname)).toBe(true));

  it.each([
    "/serving/go",
    "/serving/go/x",
    "/givefoo",
    "/grace/join",
    `/g/${A_ID}/give`,
    "/calendar",
    "/directory",
    "/eventsfoo",
  ])("does not match %s", (pathname) => expect(isLegacyGroupPath(pathname)).toBe(false));
});

describe("legacyRedirectTarget", () => {
  it("sends bare /events to the org-level calendar with no group needed", () => {
    expect(legacyRedirectTarget("/events")).toEqual({ needsGroup: false, path: "/calendar" });
  });

  it("sends an event detail under the group's calendar", () => {
    const target = legacyRedirectTarget("/events/abc");
    expect(target?.needsGroup).toBe(true);
    if (target?.needsGroup) expect(target.pathFor(A_ID)).toBe(`/g/${A_ID}/calendar/abc`);
  });

  it("keeps a team id under the group's serving section", () => {
    const target = legacyRedirectTarget("/serving/team-7");
    if (target?.needsGroup) expect(target.pathFor(A_ID)).toBe(`/g/${A_ID}/serving/team-7`);
    else throw new Error("expected a group-scoped redirect");
  });

  it("needs a group for a section root", () => {
    const target = legacyRedirectTarget("/announcements");
    expect(target?.needsGroup).toBe(true);
    if (target?.needsGroup) expect(target.pathFor(B_ID)).toBe(`/g/${B_ID}/announcements`);
  });

  it("returns null for a path that is not legacy", () => {
    expect(legacyRedirectTarget("/serving/go")).toBeNull();
    expect(legacyRedirectTarget("/calendar")).toBeNull();
  });
});

describe("swapGroupInPath", () => {
  it("keeps the page and drops entity ids", () => {
    expect(swapGroupInPath(`/g/${A_ID}/calendar/123`, B)).toBe(`/g/${B_ID}/calendar`);
    expect(swapGroupInPath(`/g/${A_ID}/lectures/series/xyz`, B)).toBe(`/g/${B_ID}/lectures`);
  });

  it("switching from Members lands on Members", () => {
    expect(swapGroupInPath(`/g/${A_ID}/directory`, B)).toBe(`/g/${B_ID}/directory`);
    expect(swapGroupInPath(`/g/${A_ID}/directory/families`, B)).toBe(
      `/g/${B_ID}/directory/families`
    );
  });

  it("keeps the give composer path", () => {
    expect(swapGroupInPath(`/g/${A_ID}/give/new`, B)).toBe(`/g/${B_ID}/give/new`);
  });

  it("keeps Group settings only when the target is led by the viewer", () => {
    expect(swapGroupInPath(`/g/${B_ID}/settings`, A)).toBe(`/g/${A_ID}/settings`);
    expect(swapGroupInPath(`/g/${A_ID}/settings`, B)).toBe(`/g/${B_ID}/dashboard`);
  });

  it("enters the target group's dashboard from the org level", () => {
    expect(swapGroupInPath("/calendar", B)).toBe(`/g/${B_ID}/dashboard`);
    expect(swapGroupInPath("/dashboard", B)).toBe(`/g/${B_ID}/dashboard`);
    expect(swapGroupInPath(`/g/${A_ID}`, B)).toBe(`/g/${B_ID}/dashboard`);
  });
});

describe("groupInitials", () => {
  it("takes the first letters of the first two words", () => {
    expect(groupInitials("Grace Fellowship")).toBe("GF");
    expect(groupInitials("Tuesday")).toBe("T");
    expect(groupInitials("  the   young  adults ")).toBe("TY");
  });
});
