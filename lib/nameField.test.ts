import { describe, expect, it } from "vitest";
import { memberNames, nameFieldError } from "@/lib/nameField";

describe("nameFieldError", () => {
  it("asks for a required name", () => {
    expect(nameFieldError("", "first name", true)).toBe("Enter a first name.");
    expect(nameFieldError(null, "last name", true)).toBe("Enter a last name.");
  });

  it("lets an optional name be empty", () => {
    expect(nameFieldError(null, "preferred name", false)).toBeUndefined();
  });

  it("refuses a name over 100 characters", () => {
    expect(nameFieldError("a".repeat(100), "last name", false)).toBeUndefined();
    expect(nameFieldError("a".repeat(101), "last name", false)).toBe(
      "Use 100 characters or fewer.",
    );
  });
});

describe("memberNames", () => {
  it("title-cases every name and saves a cleared optional one as null", () => {
    expect(
      memberNames({ first_name: "john", last_name: "MCDONALD", preferred_name: " " }, "create"),
    ).toEqual({
      names: { first_name: "John", last_name: "McDonald", preferred_name: null },
      fieldErrors: {},
    });
  });

  it("requires a first name on create", () => {
    expect(memberNames({ last_name: "Okafor" }, "create").fieldErrors).toEqual({
      first_name: "Enter a first name.",
    });
  });

  it("checks only the names an update sends", () => {
    expect(memberNames({ birth_year: 2010 }, "update")).toEqual({ names: {}, fieldErrors: {} });
    expect(memberNames({ first_name: "", last_name: "b".repeat(101) }, "update").fieldErrors).toEqual({
      first_name: "Enter a first name.",
      last_name: "Use 100 characters or fewer.",
    });
  });
});
