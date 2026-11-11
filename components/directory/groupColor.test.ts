import { describe, expect, it } from "vitest";
import { groupColor } from "@/components/directory/groupColor";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";

describe("groupColor", () => {
  it("uses the group's own color", () => {
    expect(groupColor("#5B4B8A")).toBe("#5B4B8A");
  });

  it("falls back to the default color when the group has none or it is not a hex color", () => {
    expect(groupColor(null)).toBe(GROUP_DEFAULT_COLOR);
    expect(groupColor("red; background: url(x)")).toBe(GROUP_DEFAULT_COLOR);
  });
});
