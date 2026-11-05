import { describe, expect, it } from "vitest";
import {
  coupleName,
  ownSignupLabel,
  personInitials,
  personName,
  personNameOrEmail,
  signupDisplayName,
  spouseFirstName,
} from "./display";

const blank = { first_name: null, last_name: null, preferred_name: null };
// A row read with its address, as the service client's send paths hold it.
const nameless = { ...blank, id: "new", email: "new@x.test" };

describe("personName", () => {
  it("uses the name when there is one", () => {
    expect(personName({ ...blank, first_name: "Daniel", preferred_name: "Danny", last_name: "Smith" })).toBe("Danny Smith");
  });

  it("says so when there is no name", () => {
    expect(personName({ ...blank, first_name: "  " })).toBe("No name on file");
  });
});

describe("a row that carries an address", () => {
  it("is never named by it, in any label other people read", () => {
    const named = { ...blank, id: "david", first_name: "David", last_name: "Reyes" };
    expect(personName(nameless)).toBe("No name on file");
    expect(spouseFirstName(nameless)).toBe("No name on file");
    expect(personInitials(nameless)).toBe("?");
    expect(coupleName(named, nameless)).toBe("David Reyes & No name on file");
    expect(signupDisplayName([nameless])).toBe("No name on file");
    expect(signupDisplayName([named, nameless])).toBe("David Reyes & No name on file");
    expect(ownSignupLabel([named, nameless], "david")).toBe("You & No name on file");
  });
});

describe("personNameOrEmail", () => {
  it("uses the name when there is one, and the email only when there is none", () => {
    expect(personNameOrEmail({ ...blank, first_name: "Ada", last_name: "Lovelace", email: "ada@x.test" })).toBe("Ada Lovelace");
    expect(personNameOrEmail(nameless)).toBe("new@x.test");
    expect(personNameOrEmail({ ...blank, email: null })).toBe("No name on file");
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
  });

  it("uses the preferred name", () => {
    expect(coupleName({ ...blank, first_name: "Benjamin", preferred_name: "Ben", last_name: "Hale" }, { ...blank, first_name: "Ann", last_name: "Hale" })).toBe(
      "Ben & Ann Hale",
    );
  });
});

describe("signupDisplayName", () => {
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

  it("calls a spouse without a first name by their last name", () => {
    expect(spouseFirstName({ ...blank, last_name: "Hale" })).toBe("Hale");
  });
});

describe("personInitials", () => {
  it("takes the name's initials", () => {
    expect(personInitials({ ...blank, first_name: "Ada", last_name: "Lovelace" })).toBe("AL");
  });
});
