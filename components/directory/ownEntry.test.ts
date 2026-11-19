import { describe, expect, it } from "vitest";
import { isOwnEntry, isOwnHousehold } from "./ownEntry";

describe("isOwnEntry", () => {
  it("is true only for the viewer's own profile", () => {
    expect(isOwnEntry({ id: "me" }, "me")).toBe(true);
    expect(isOwnEntry({ id: "someone" }, "me")).toBe(false);
  });

  it("is false when there is no viewer", () => {
    expect(isOwnEntry({ id: "me" }, undefined)).toBe(false);
    expect(isOwnEntry({ id: "" }, "")).toBe(false);
  });
});

describe("isOwnHousehold", () => {
  it("is true only for the viewer's own household", () => {
    expect(isOwnHousehold({ id: "f1" }, "f1")).toBe(true);
    expect(isOwnHousehold({ id: "f2" }, "f1")).toBe(false);
  });

  it("is false when the viewer has no household", () => {
    expect(isOwnHousehold({ id: "f1" }, null)).toBe(false);
    expect(isOwnHousehold({ id: "" }, "")).toBe(false);
  });
});
