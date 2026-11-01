import { describe, expect, it } from "vitest";
import { labelFormErrors } from "./labelForm";

describe("labelFormErrors", () => {
  it("accepts what a color picker produces, and no color at all", () => {
    expect(labelFormErrors({ name: "Men", color: "#b85c38" })).toEqual({});
    expect(labelFormErrors({ name: "Men", color: null })).toEqual({});
  });

  it("asks for a name, ignoring blanks", () => {
    expect(labelFormErrors({ name: "  ", color: null }).name).toBe("Enter a label name.");
  });

  it.each(["", "#abc", "red", "#b85c38;background:url(x)"])("refuses the color %j", (color) => {
    expect(labelFormErrors({ name: "Men", color }).color).toBe("Choose a color.");
  });
});
