import { describe, expect, it } from "vitest";
import { personInitials, personName, signupDisplayName } from "./display";

const blank = { first_name: null, last_name: null, preferred_name: null };

describe("personName", () => {
  it("uses the name when there is one", () => {
    expect(personName({ ...blank, first_name: "Daniel", preferred_name: "Danny", last_name: "Smith", email: "d@x.test" })).toBe(
      "Danny Smith",
    );
  });

  it("shows the email for someone with no name yet", () => {
    expect(personName({ ...blank, first_name: "  ", email: "new@x.test" })).toBe("new@x.test");
  });

  it("says so when there is neither", () => {
    expect(personName(blank)).toBe("No name on file");
  });
});

describe("signupDisplayName", () => {
  it("shows a single attendee without a name by their email", () => {
    expect(signupDisplayName([{ ...blank, email: "new@x.test" }], null)).toBe("new@x.test");
  });

  it("uses the household name for a couple", () => {
    expect(signupDisplayName([{ ...blank, first_name: "A" }, { ...blank, first_name: "B" }], "The Smiths")).toBe("The Smiths");
  });

  it("names nobody when no attendee is visible", () => {
    expect(signupDisplayName([], null)).toBe("Someone");
  });
});

describe("personInitials", () => {
  it("takes the email's first letter when there is no name", () => {
    expect(personInitials({ ...blank, email: "new@x.test" })).toBe("N");
    expect(personInitials({ ...blank, first_name: "Ada", last_name: "Lovelace", email: "new@x.test" })).toBe("AL");
  });
});
