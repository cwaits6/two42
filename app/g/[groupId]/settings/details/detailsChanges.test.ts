import { describe, expect, it } from "vitest";
import { colorError, detailsChanges } from "./detailsChanges";

const saved = { color: "#B85C38" };

describe("detailsChanges", () => {
  it("is empty when nothing changed", () => {
    expect(detailsChanges(saved, { ...saved })).toEqual({});
  });

  it("carries the color when it changed", () => {
    expect(detailsChanges(saved, { color: "#2A211A" })).toEqual({ color: "#2A211A" });
  });
});

describe("field errors", () => {
  it("accepts only a color that can carry legible text", () => {
    expect(colorError("#B85C38")).toBeUndefined();
    expect(colorError("#7d7d7d")).toBeDefined();
    expect(colorError("red")).toBeDefined();
  });
});
