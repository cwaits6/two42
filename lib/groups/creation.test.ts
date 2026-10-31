import { describe, expect, it } from "vitest";
import {
  GROUP_CREATION_POLICIES,
  GROUP_CREATION_POLICY_OPTIONS,
  GROUP_DESCRIPTION_MAX,
  GROUP_NAME_MAX,
  creationActionFor,
  groupCreationErrorMessage,
  parseGroupCreationPolicy,
  validateGroupDescription,
  validateGroupName,
} from "@/lib/groups/creation";

describe("parseGroupCreationPolicy", () => {
  it.each(GROUP_CREATION_POLICIES)("passes %s through", (policy) => {
    expect(parseGroupCreationPolicy(policy)).toBe(policy);
  });

  it.each([null, undefined, "everyone", 42, ""])("falls back to approval for %p", (raw) => {
    expect(parseGroupCreationPolicy(raw)).toBe("approval");
  });
});

describe("creationActionFor", () => {
  it.each([
    ["open", false, "create"],
    ["approval", false, "request"],
    ["admins", false, null],
    ["open", true, "create"],
    ["approval", true, "create"],
    ["admins", true, "create"],
  ] as const)("%s policy, admin=%s → %s", (policy, isOrgAdmin, kind) => {
    expect(creationActionFor(policy, isOrgAdmin)?.kind ?? null).toBe(kind);
  });

  it("labels the two actions for the button", () => {
    expect(creationActionFor("open", false)?.label).toBe("Create a group");
    expect(creationActionFor("approval", false)?.label).toBe("Request a group");
  });
});

describe("validateGroupName", () => {
  it("refuses blank and whitespace-only names", () => {
    expect(validateGroupName("")).toEqual({ ok: false, reason: "Enter a group name." });
    expect(validateGroupName("   ")).toEqual({ ok: false, reason: "Enter a group name." });
  });

  it("trims", () => {
    expect(validateGroupName("  Men's Breakfast ")).toEqual({ ok: true, value: "Men's Breakfast" });
  });

  it("refuses a name over the limit and accepts one at it", () => {
    expect(validateGroupName("x".repeat(GROUP_NAME_MAX + 1)).ok).toBe(false);
    expect(validateGroupName("x".repeat(GROUP_NAME_MAX)).ok).toBe(true);
  });
});

describe("validateGroupDescription", () => {
  it("stores empty as null", () => {
    expect(validateGroupDescription("")).toEqual({ ok: true, value: null });
    expect(validateGroupDescription("  ")).toEqual({ ok: true, value: null });
  });

  it("trims", () => {
    expect(validateGroupDescription(" Saturdays, 8:00 am ")).toEqual({
      ok: true,
      value: "Saturdays, 8:00 am",
    });
  });

  it("refuses a description over the limit", () => {
    expect(validateGroupDescription("x".repeat(GROUP_DESCRIPTION_MAX + 1)).ok).toBe(false);
    expect(validateGroupDescription("x".repeat(GROUP_DESCRIPTION_MAX)).ok).toBe(true);
  });
});

describe("groupCreationErrorMessage", () => {
  const fallback = "Couldn't create the group. Please try again.";

  it.each(["GC001", "GC002", "GC003", "GC004", "GC005", "GC006", "GC007"])(
    "maps %s to its own sentence",
    (code) => {
      const message = groupCreationErrorMessage(code);
      expect(message).not.toBe(fallback);
      expect(message).toMatch(/\.$/);
    }
  );

  it("falls back for unknown and missing codes", () => {
    expect(groupCreationErrorMessage("GC999")).toBe(fallback);
    expect(groupCreationErrorMessage("23505")).toBe(fallback);
    expect(groupCreationErrorMessage(undefined)).toBe(fallback);
  });
});

describe("GROUP_CREATION_POLICY_OPTIONS", () => {
  it("lists the three policies in order, each with a label and description", () => {
    expect(GROUP_CREATION_POLICY_OPTIONS.map((o) => o.value)).toEqual([
      "open",
      "approval",
      "admins",
    ]);
    for (const option of GROUP_CREATION_POLICY_OPTIONS) {
      expect(option.label).not.toBe("");
      expect(option.description).not.toBe("");
    }
  });
});
