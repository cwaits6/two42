import { describe, expect, it } from "vitest";
import { validateInvitePerson } from "@/lib/members/invite-form";

describe("validateInvitePerson", () => {
  it("capitalizes the names and lowercases the email", () => {
    const { input, errors } = validateInvitePerson({
      email: " Name@Example.COM ",
      firstName: "john",
      lastName: "MCDONALD",
    });
    expect(errors).toEqual({});
    expect(input).toMatchObject({
      email: "name@example.com",
      firstName: "John",
      lastName: "McDonald",
    });
  });

  it("reports an empty or over-long name on its field", () => {
    const { errors } = validateInvitePerson({
      email: "ana@example.com",
      firstName: "   ",
      lastName: "x".repeat(101),
    });
    expect(errors).toEqual({
      firstName: "Enter a first name.",
      lastName: "Use 100 characters or fewer.",
    });
  });
});
