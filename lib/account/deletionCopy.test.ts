import { describe, expect, it } from "vitest";
import {
  deletionCopy,
  DOWNLOAD_LEAVES_OUT,
  photosNotRemovedMessage,
  refusalMessage,
  type DeletionSummary,
} from "./deletionCopy";

const names = {
  kind: "names",
  fundsRetired: [],
  fundsDeleted: [],
  groupsLosingLeader: [],
} as const;

const base: DeletionSummary = {
  name: "Ada Okafor",
  lastChurchAdmin: false,
  platformOperator: false,
  groupContent: { ...names, fundsRetired: [], fundsDeleted: [], groupsLosingLeader: [] },
  household: null,
};

describe("deletionCopy", () => {
  it("names a fund with no second person as deleted, with its payment methods", () => {
    const { goes } = deletionCopy(
      { ...base, groupContent: { ...names, fundsRetired: [], groupsLosingLeader: [], fundsDeleted: [{ name: "Mission trip", group: "Grace" }] } },
      "self",
    );
    expect(goes).toContain("The Mission trip fund in Grace, and its payment methods");
  });

  it("says a fund goes to the second person, retired until a leader reopens it", () => {
    const { goes, stays } = deletionCopy(
      {
        ...base,
        groupContent: {
          ...names,
          fundsDeleted: [],
          groupsLosingLeader: [],
          fundsRetired: [{ name: "Mission trip", group: "Grace", recipient: "Ben Lee" }],
        },
      },
      "self",
    );
    expect(stays).toContain(
      "The Mission trip fund in Grace, which goes to Ben Lee, retired until a leader checks its payment methods and reopens it",
    );
    expect(goes.join(" ")).not.toContain("Mission trip");
  });

  it("counts funds and groups for a church admin", () => {
    const { goes, stays } = deletionCopy(
      { ...base, groupContent: { kind: "counts", fundsRetired: 2, fundsDeleted: 1, groupsLosingLeader: 3 } },
      "other",
    );
    expect(goes).toContain("1 fund they receive, and its payment methods");
    expect(stays).toContain(
      "2 funds they receive, which go to the second person, retired until a leader checks their payment methods and reopens them",
    );
    expect(stays).toContain("3 groups with no leader until a church admin adds one");
  });

  it("mentions no fund or group when a church admin's counts are zero", () => {
    const { goes, stays } = deletionCopy(
      { ...base, groupContent: { kind: "counts", fundsRetired: 0, fundsDeleted: 0, groupsLosingLeader: 0 } },
      "other",
    );
    expect([...goes, ...stays].join(" ")).not.toMatch(/\bfunds? they\b|\bgroups? with\b/);
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
    const { stays } = deletionCopy(
      { ...base, groupContent: { ...names, fundsRetired: [], fundsDeleted: [], groupsLosingLeader: ["Grace"] } },
      "self",
    );
    expect(stays).toContain("Grace, with no leader until a church admin adds one");
  });

  it("speaks to the person deleting their own account", () => {
    const copy = deletionCopy(base, "self");
    expect(copy.title).toBe("Delete your account?");
    expect(copy.confirmLabel).toBe("Delete my account");
    expect(copy.goes[0]).toBe("Your profile, photo and sign-in");
  });

  it("tells the person what the download leaves out", () => {
    expect(deletionCopy(base, "self").description).toContain(DOWNLOAD_LEAVES_OUT);
    expect(deletionCopy(base, "other").description).not.toContain(DOWNLOAD_LEAVES_OUT);
  });

  it("names whose account a church admin is deleting, and calls it deleting", () => {
    const copy = deletionCopy(base, "other");
    expect(copy.title).toBe("Delete Ada Okafor's account?");
    expect(copy.confirmLabel).toBe("Delete account");
    expect(JSON.stringify(copy)).not.toMatch(/\bremov/i);
    expect(copy.goes[0]).toBe("Their profile, photo and sign-in");
  });
});

describe("refusalMessage", () => {
  it("says which refusal it is, and nothing for any other error", () => {
    expect(refusalMessage("platform_operator", "other")).toContain("platform operator");
    expect(refusalMessage("last_church_admin", "self")).toContain("at least one church admin");
    expect(refusalMessage("Failed to delete", "self")).toBeUndefined();
  });
});

describe("photosNotRemovedMessage", () => {
  it("says the account is gone and how many photos aren't", () => {
    expect(photosNotRemovedMessage(1, "self")).toContain("deleted, but 1 photo is still stored");
    expect(photosNotRemovedMessage(2, "other")).toContain("deleted, but 2 photos are still stored");
  });
});
