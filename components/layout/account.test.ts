import { describe, expect, it } from "vitest";
import { buildAccount } from "./account";

const isaac = { first_name: "Isaac", last_name: "Seedly", preferred_name: null };
const INFO = ["Help", "Privacy", "Terms"];

function account(overrides: Partial<Parameters<typeof buildAccount>[0]>) {
  return buildAccount({ profile: null, email: null, isOperator: false, photoUrl: null, ...overrides });
}

const labels = (a: ReturnType<typeof buildAccount>) => a.rows.map((r) => r.label);

describe("buildAccount", () => {
  it("gives a member their own pages, then Help, Privacy and Terms", () => {
    const a = account({ profile: { ...isaac, role: "member" }, email: "isaac@example.test" });
    expect(labels(a)).toEqual(["My profile", "Settings", ...INFO]);
    expect(a).toMatchObject({ name: "Isaac Seedly", initials: "IS", homeHref: "/dashboard" });
    expect(a.rows.map((r) => r.href)).toEqual([
      "/profile",
      "/settings",
      "mailto:hello@two42.io",
      "/privacy",
      "/terms",
    ]);
  });

  it("adds Church admin for a church admin only", () => {
    const a = account({ profile: { ...isaac, role: "admin" } });
    expect(labels(a)).toEqual(["My profile", "Settings", "Church admin", ...INFO]);
    expect(a).toMatchObject({ isChurchAdmin: true, isOperator: false });
  });

  it("gives an operator with no church Platform and their sign-in address for a name", () => {
    const a = account({ email: "platform@local.dev", isOperator: true });
    expect(labels(a)).toEqual(["Platform", ...INFO]);
    expect(a).toMatchObject({
      name: "platform@local.dev",
      initials: "P",
      isMember: false,
      isChurchAdmin: false,
      homeHref: "/",
    });
  });

  it("puts Church admin before Platform for a church admin who is also an operator", () => {
    const a = account({ profile: { ...isaac, role: "admin" }, isOperator: true });
    expect(labels(a)).toEqual(["My profile", "Settings", "Church admin", "Platform", ...INFO]);
  });

  it("offers a pending person only Help, Privacy and Terms, under their own name", () => {
    const a = account({ profile: { ...isaac, role: "pending" }, email: "isaac@example.test" });
    expect(labels(a)).toEqual(INFO);
    expect(a).toMatchObject({ name: "Isaac Seedly", initials: "IS", isMember: false, homeHref: "/" });
  });

  it("reads an unrecognized stored role as pending", () => {
    expect(labels(account({ profile: { ...isaac, role: "owner" } }))).toEqual(INFO);
  });

  it("uses the preferred name", () => {
    const a = account({ profile: { ...isaac, preferred_name: "Ike", role: "member" } });
    expect(a).toMatchObject({ name: "Ike Seedly", initials: "IS" });
  });

  it("falls back to the sign-in address when the profile has no name", () => {
    const a = account({
      profile: { first_name: null, last_name: " ", preferred_name: null, role: "member" },
      email: "someone@example.test",
    });
    expect(a).toMatchObject({ name: "someone@example.test", initials: "S" });
  });

  it("still names the block with neither a name nor an address", () => {
    expect(account({})).toMatchObject({ name: "Account", initials: "" });
  });

  it("passes the signed photo address through", () => {
    expect(account({ photoUrl: "https://example.test/signed" }).photoUrl).toBe("https://example.test/signed");
  });
});
