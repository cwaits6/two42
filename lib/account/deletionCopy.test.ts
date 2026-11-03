import { describe, expect, it } from "vitest";
import {
  alreadyGoneMessage,
  deletionCopy,
  DOWNLOAD_COVERS,
  DOWNLOAD_LEAVES_OUT,
  photosNotRemovedMessage,
  refusalMessage,
  type DeletionSummary,
} from "./deletionCopy";

const names = {
  kind: "names",
  fundsPassedOn: [],
  fundsNeedingRecipient: [],
  groupsLosingLeader: [],
} as const;

const base: DeletionSummary = {
  name: "Ada Okafor",
  lastChurchAdmin: false,
  platformOperator: false,
  groupContent: { ...names, fundsPassedOn: [], fundsNeedingRecipient: [], groupsLosingLeader: [] },
  household: null,
};

describe("deletionCopy", () => {
  it("says a fund with no second person stays, with its payment methods, and never that it goes", () => {
    const { goes, stays } = deletionCopy(
      { ...base, groupContent: { ...names, fundsPassedOn: [], groupsLosingLeader: [], fundsNeedingRecipient: [{ name: "Mission trip", group: "Grace" }] } },
      "self",
    );
    expect(stays).toContain(
      "The Mission trip fund in Grace, and its payment methods, off Give until a leader chooses who receives it and confirms it",
    );
    expect(goes.join(" ")).not.toContain("Mission trip");
  });

  it("says a fund goes to the second person, off Give until a leader confirms it", () => {
    const { goes, stays } = deletionCopy(
      {
        ...base,
        groupContent: {
          ...names,
          fundsNeedingRecipient: [],
          groupsLosingLeader: [],
          fundsPassedOn: [{ name: "Mission trip", group: "Grace", recipient: "Ben Lee" }],
        },
      },
      "self",
    );
    expect(stays).toContain("The Mission trip fund in Grace, which goes to Ben Lee, off Give until a leader confirms it");
    expect(goes.join(" ")).not.toContain("Mission trip");
  });

  it("counts funds and groups for a church admin", () => {
    const { goes, stays } = deletionCopy(
      { ...base, groupContent: { kind: "counts", fundsPassedOn: 2, fundsNeedingRecipient: 1, groupsLosingLeader: 3 } },
      "other",
    );
    expect(goes.join(" ")).not.toMatch(/\bfunds? they\b/);
    expect(stays).toContain(
      "2 funds they receive, which go to the second person, off Give until a leader confirms them",
    );
    expect(stays).toContain(
      "1 fund they receive, and its payment methods, off Give until a leader chooses who receives it and confirms it",
    );
    expect(stays).toContain("3 groups with no leader until a church admin adds one");
  });

  it("mentions no fund or group when a church admin's counts are zero", () => {
    const { goes, stays } = deletionCopy(
      { ...base, groupContent: { kind: "counts", fundsPassedOn: 0, fundsNeedingRecipient: 0, groupsLosingLeader: 0 } },
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
      { ...base, groupContent: { ...names, fundsPassedOn: [], fundsNeedingRecipient: [], groupsLosingLeader: ["Grace"] } },
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

describe("the download's copy", () => {
  it("says the file holds what the person wrote in their requests", () => {
    expect(DOWNLOAD_COVERS).toMatch(/group requests/);
    expect(DOWNLOAD_COVERS).toMatch(/request for access/);
  });

  it("names what the file leaves out", () => {
    for (const left of [/requests to join a group/, /teacher/, /calendar link/]) {
      expect(DOWNLOAD_LEAVES_OUT).toMatch(left);
    }
  });
});

describe("alreadyGoneMessage", () => {
  it("is only for a 404, and a self-delete's 401", () => {
    expect(alreadyGoneMessage(404, "self")).toBe("Your account is already deleted.");
    expect(alreadyGoneMessage(404, "other")).toBe("That account is already deleted.");
    expect(alreadyGoneMessage(401, "self")).toBe("You're signed out.");
    expect(alreadyGoneMessage(401, "other")).toBeUndefined();
    expect(alreadyGoneMessage(500, "self")).toBeUndefined();
    expect(alreadyGoneMessage(200, "self")).toBeUndefined();
  });
});
