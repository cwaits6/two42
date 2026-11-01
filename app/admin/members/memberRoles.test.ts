import { describe, expect, it } from "vitest";
import { ROLE_LABELS, ROLE_OPTIONS, roleChangeCopy, roleLockReason } from "./memberRoles";

describe("role names", () => {
  it("offers readable roles and never Pending", () => {
    expect(ROLE_OPTIONS.map((o) => o.label)).toEqual(["Member", "Church admin"]);
    expect(ROLE_OPTIONS.map((o) => o.value)).toEqual(["member", "admin"]);
    expect(ROLE_LABELS.admin).toBe("Church admin");
  });
});

describe("roleChangeCopy", () => {
  it("names the person and the action for each change", () => {
    expect(roleChangeCopy("Ada", "member", "admin")).toMatchObject({
      title: "Make Ada a church admin?",
      confirmLabel: "Make church admin",
    });
    expect(roleChangeCopy("Ada", "admin", "member")).toMatchObject({
      title: "Change Ada to member?",
      confirmLabel: "Change to member",
    });
    expect(roleChangeCopy("Ada", "pending", "member")).toMatchObject({
      title: "Approve Ada as a member?",
      confirmLabel: "Approve member",
    });
    expect(roleChangeCopy("Ada", "pending", "admin").confirmLabel).toBe("Make church admin");
    expect(roleChangeCopy("Ada", "admin", "pending")).toMatchObject({
      title: "Move Ada back to pending?",
      confirmLabel: "Move to pending",
    });
  });
});

describe("roleLockReason", () => {
  const viewer = { id: "me" };

  it("leaves every other row open", () => {
    expect(roleLockReason({ id: "you" }, "me", [{ role: "admin" }])).toBeNull();
  });

  it("explains the viewer's own row, naming the rule when they are the last admin", () => {
    expect(roleLockReason(viewer, "me", [{ role: "admin" }, { role: "member" }])).toMatch(
      /needs at least one church admin/,
    );
    expect(roleLockReason(viewer, "me", [{ role: "admin" }, { role: "admin" }])).toBe(
      "Another church admin can change your role.",
    );
  });
});
