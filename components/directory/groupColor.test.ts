import { describe, expect, it } from "vitest";
import { groupColor } from "@/components/directory/groupColor";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";

const memberships = [
  { id: "a", color: "#2F6F4F" },
  { id: "b", color: "#5B4B8A" },
];

describe("groupColor", () => {
  it("uses the color of a group the viewer is in", () => {
    expect(groupColor("b", memberships)).toBe("#5B4B8A");
  });

  it("falls back to the default color for a group the viewer is not in", () => {
    expect(groupColor("z", memberships)).toBe(GROUP_DEFAULT_COLOR);
    expect(groupColor("a", [])).toBe(GROUP_DEFAULT_COLOR);
  });
});
