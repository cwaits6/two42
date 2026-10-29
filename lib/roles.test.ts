import { describe, expect, it } from "vitest";
import { isMemberRole, STORED_MEMBER_ROLES, toUserRole } from "@/lib/roles";

describe("toUserRole", () => {
  it.each(["pending", "member", "admin"] as const)("keeps %s", (role) => {
    expect(toUserRole(role)).toBe(role);
  });

  it("reads a retired content editor as a member, never an admin", () => {
    expect(toUserRole("content_editor")).toBe("member");
  });

  it("reads an unrecognized value as pending", () => {
    expect(toUserRole("owner")).toBe("pending");
    expect(toUserRole("")).toBe("pending");
    expect(toUserRole("toString")).toBe("pending");
  });
});

describe("isMemberRole", () => {
  it("admits members, admins and retired content editors", () => {
    expect(isMemberRole("member")).toBe(true);
    expect(isMemberRole("admin")).toBe(true);
    expect(isMemberRole("content_editor")).toBe(true);
  });

  it("refuses pending and unrecognized values", () => {
    expect(isMemberRole("pending")).toBe(false);
    expect(isMemberRole("owner")).toBe(false);
  });
});

describe("STORED_MEMBER_ROLES", () => {
  it("lists exactly the stored values that read as members", () => {
    expect([...STORED_MEMBER_ROLES].sort()).toEqual(["admin", "content_editor", "member"]);
  });
});
