import { describe, expect, it } from "vitest";
import { ABILITY_COPY, GROUP_ABILITIES, can, canManageAnything, isGroupAbility } from "@/lib/groups/abilities";

describe("can", () => {
  it("lets a leader do everything without any ability", () => {
    for (const ability of GROUP_ABILITIES) expect(can({ role: "leader" }, ability)).toBe(true);
  });

  it("lets a member do only what they were given", () => {
    const member = { role: "member" as const, abilities: ["calendar" as const] };
    expect(can(member, "calendar")).toBe(true);
    expect(can(member, "announcements")).toBe(false);
    expect(can({ role: "member" }, "calendar")).toBe(false);
  });
});

describe("canManageAnything", () => {
  it("is true for a leader or a member holding any ability", () => {
    expect(canManageAnything({ role: "leader" })).toBe(true);
    expect(canManageAnything({ role: "member", abilities: ["lessons"] })).toBe(true);
    expect(canManageAnything({ role: "member", abilities: [] })).toBe(false);
    expect(canManageAnything({ role: "member" })).toBe(false);
  });
});

describe("isGroupAbility", () => {
  it("accepts only the fixed list", () => {
    expect(isGroupAbility("prayer_care")).toBe(true);
    expect(isGroupAbility("leader")).toBe(false);
  });
});

describe("ABILITY_COPY", () => {
  it("names every ability with a verb-led label", () => {
    expect(Object.keys(ABILITY_COPY).sort()).toEqual([...GROUP_ABILITIES].sort());
  });
});
