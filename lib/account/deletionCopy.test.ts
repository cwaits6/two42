import { describe, expect, it } from "vitest";
import { deletionCopy, type DeletionSummary } from "./deletionCopy";

const base: DeletionSummary = {
  name: "Ada Okafor",
  lastChurchAdmin: false,
  funds: [],
  household: null,
  groupsLosingLeader: [],
};

describe("deletionCopy", () => {
  it("names a fund that goes with the person, and says its payment methods go too", () => {
    const { goes } = deletionCopy({ ...base, funds: [{ name: "Mission trip", group: "Grace" }] }, "self");
    expect(goes).toContain("The Mission trip fund in Grace, and its payment methods");
  });

  it("says a shared household stays with everyone else's details", () => {
    const { goes, stays } = deletionCopy(
      { ...base, household: { name: "Okafor", shared: true, entries: ["Kid"] } },
      "self",
    );
    expect(stays).toContain("The Okafor household, and everyone else's details in it");
    expect(goes.join(" ")).not.toContain("Okafor");
  });

  it("says a household with no one else left goes, naming who is listed in it", () => {
    const { goes, stays } = deletionCopy(
      { ...base, household: { name: "Okafor", shared: false, entries: ["Kid"] } },
      "self",
    );
    expect(goes).toContain("The Okafor household, and the people listed in it: Kid");
    expect(stays.join(" ")).not.toContain("Okafor");
  });

  it("says a group stays without a leader", () => {
    const { stays } = deletionCopy({ ...base, groupsLosingLeader: ["Grace"] }, "self");
    expect(stays).toContain("Grace, with no leader until a church admin adds one");
  });

  it("speaks to the person deleting their own account", () => {
    const copy = deletionCopy(base, "self");
    expect(copy.title).toBe("Delete your account?");
    expect(copy.confirmLabel).toBe("Delete my account");
    expect(copy.goes[0]).toBe("Your profile, photo and sign-in");
  });

  it("names the person a church admin is removing", () => {
    const copy = deletionCopy(base, "other");
    expect(copy.title).toBe("Remove Ada Okafor from the church?");
    expect(copy.description).toContain("deletes their account");
    expect(copy.goes[0]).toBe("Their profile, photo and sign-in");
  });
});
