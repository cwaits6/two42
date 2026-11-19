import { describe, expect, it } from "vitest";
import { isOwnEntry, isOwnHousehold } from "./ownEntry";
import type { FamilyDirectoryFull } from "@/lib/types";

const household = (...ids: string[]) =>
  ({ members: ids.map((id) => ({ id })) }) as unknown as Pick<FamilyDirectoryFull, "members">;

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
  it("is true when the viewer is one of the household's members", () => {
    expect(isOwnHousehold(household("spouse", "me"), "me")).toBe(true);
  });

  it("is false for a household the viewer is not in", () => {
    expect(isOwnHousehold(household("a", "b"), "me")).toBe(false);
    expect(isOwnHousehold(household(), "me")).toBe(false);
  });

  it("is false when there is no viewer", () => {
    expect(isOwnHousehold(household("me"), undefined)).toBe(false);
  });
});
