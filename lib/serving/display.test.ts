import { describe, expect, it } from "vitest";
import { coupleName, ownSignupLabel, personInitials, personName, signupDisplayName, spouseFirstName } from "./display";

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

describe("coupleName", () => {
  it("joins the first names before a shared last name", () => {
    expect(coupleName({ ...blank, first_name: "David", last_name: "Reyes" }, { ...blank, first_name: "Lena", last_name: "Reyes" })).toBe(
      "David & Lena Reyes",
    );
  });

  it("keeps both full names when the last names differ or one is missing", () => {
    expect(coupleName({ ...blank, first_name: "David", last_name: "Reyes" }, { ...blank, first_name: "Lena", last_name: "Cho" })).toBe(
      "David Reyes & Lena Cho",
    );
    expect(coupleName({ ...blank, first_name: "David", last_name: "Reyes" }, { ...blank, email: "lena@x.test" })).toBe(
      "David Reyes & lena@x.test",
    );
  });

  it("uses the preferred name", () => {
    expect(coupleName({ ...blank, first_name: "Benjamin", preferred_name: "Ben", last_name: "Hale" }, { ...blank, first_name: "Ann", last_name: "Hale" })).toBe(
      "Ben & Ann Hale",
    );
  });
});

describe("signupDisplayName", () => {
  it("shows a single attendee without a name by their email", () => {
    expect(signupDisplayName([{ ...blank, email: "new@x.test" }])).toBe("new@x.test");
  });

  it("names a couple by name, never by household", () => {
    expect(signupDisplayName([{ ...blank, first_name: "David", last_name: "Reyes" }, { ...blank, first_name: "Lena", last_name: "Reyes" }])).toBe(
      "David & Lena Reyes",
    );
  });

  it("names nobody when no attendee is visible", () => {
    expect(signupDisplayName([])).toBe("Someone");
  });
});

describe("ownSignupLabel", () => {
  const me = { ...blank, id: "me", first_name: "Hannah", last_name: "Hale" };
  const ben = { ...blank, id: "ben", first_name: "Benjamin", preferred_name: "Ben", last_name: "Hale" };

  it("says You, You & Ben, or the spouse alone", () => {
    expect(ownSignupLabel([me], "me")).toBe("You");
    expect(ownSignupLabel([me, ben], "me")).toBe("You & Ben");
    expect(ownSignupLabel([ben], "me")).toBe("Ben Hale");
  });

  it("calls a spouse without a first name by what is on file", () => {
    expect(spouseFirstName({ ...blank, email: "ben@x.test" })).toBe("ben@x.test");
  });
});

describe("personInitials", () => {
  it("takes the email's first letter when there is no name", () => {
    expect(personInitials({ ...blank, email: "new@x.test" })).toBe("N");
    expect(personInitials({ ...blank, first_name: "Ada", last_name: "Lovelace", email: "new@x.test" })).toBe("AL");
  });
});
