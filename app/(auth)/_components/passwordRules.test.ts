import { describe, expect, it } from "vitest";
import { passwordFieldErrors } from "./passwordRules";

describe("passwordFieldErrors", () => {
  it("asks for a longer password before checking the confirmation", () => {
    expect(passwordFieldErrors("short", "other")).toEqual({
      password: "Enter a password of at least 8 characters.",
    });
  });

  it("marks the confirmation when the two passwords differ", () => {
    expect(passwordFieldErrors("long enough", "long enougH")).toEqual({
      confirmPassword: "Enter the same password again.",
    });
  });

  it("finds nothing to fix in a matching password of eight characters", () => {
    expect(passwordFieldErrors("12345678", "12345678")).toEqual({});
  });
});
