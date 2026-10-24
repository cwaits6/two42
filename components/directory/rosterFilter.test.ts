import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTER,
  applyRosterFilter,
  bulkLabelState,
  filterButtonLabel,
  isEmptyFilter,
  matchesRosterFilter,
  toggleInSet,
  type RosterFilter,
  type RosterIndex,
} from "./rosterFilter";

// Four people: Ann is on team T with label L; Ben is on T without L; Cal
// has L but is not on T; Dee has nothing.
const people = [{ id: "ann" }, { id: "ben" }, { id: "cal" }, { id: "dee" }];
const index: RosterIndex = {
  teamsByProfile: new Map([
    ["ann", new Set(["T"])],
    ["ben", new Set(["T", "U"])],
  ]),
  labelsByProfile: new Map([
    ["ann", new Set(["L", "M"])],
    ["cal", new Set(["L"])],
  ]),
};

const filter = (teamIds: string[], labelIds: string[]): RosterFilter => ({
  teamIds: new Set(teamIds),
  labelIds: new Set(labelIds),
});
const ids = (list: { id: string }[]) => list.map((p) => p.id);

describe("applyRosterFilter", () => {
  it("keeps everyone under an empty filter, including people with no teams and no labels", () => {
    expect(ids(applyRosterFilter(people, EMPTY_FILTER, index))).toEqual(["ann", "ben", "cal", "dee"]);
  });

  it("keeps exactly a selected team's people", () => {
    expect(ids(applyRosterFilter(people, filter(["T"], []), index))).toEqual(["ann", "ben"]);
  });

  it("keeps exactly a selected label's people", () => {
    expect(ids(applyRosterFilter(people, filter([], ["L"]), index))).toEqual(["ann", "cal"]);
  });

  it("intersects a team and a label", () => {
    expect(ids(applyRosterFilter(people, filter(["T"], ["L"]), index))).toEqual(["ann"]);
  });

  it("requires both of two selected labels", () => {
    expect(ids(applyRosterFilter(people, filter([], ["L", "M"]), index))).toEqual(["ann"]);
  });

  it("drops a person absent from both index maps under any non-empty filter", () => {
    expect(matchesRosterFilter("dee", filter(["T"], []), index)).toBe(false);
    expect(matchesRosterFilter("dee", filter([], ["L"]), index)).toBe(false);
    expect(matchesRosterFilter("dee", EMPTY_FILTER, index)).toBe(true);
  });
});

describe("filterButtonLabel", () => {
  it("reads Filter when nothing is selected", () => {
    expect(filterButtonLabel(EMPTY_FILTER)).toBe("Filter");
    expect(isEmptyFilter(EMPTY_FILTER)).toBe(true);
  });

  it("counts teams plus labels", () => {
    expect(filterButtonLabel(filter(["T"], []))).toBe("1 selected");
    expect(filterButtonLabel(filter(["T", "U"], ["L"]))).toBe("3 selected");
  });
});

describe("toggleInSet", () => {
  it("adds a missing id and removes a present one without mutating the input", () => {
    const start = new Set(["T"]);
    const added = toggleInSet(start, "U");
    expect([...added]).toEqual(["T", "U"]);
    expect([...toggleInSet(added, "T")]).toEqual(["U"]);
    expect([...start]).toEqual(["T"]);
  });
});

describe("bulkLabelState", () => {
  const selection = new Set(["ann", "ben", "cal"]);

  it("is all when every selected person has the label", () => {
    expect(bulkLabelState(new Set(["ann", "cal"]), "L", index)).toBe("all");
  });

  it("is some when only part of the selection has the label", () => {
    expect(bulkLabelState(selection, "L", index)).toBe("some");
  });

  it("is none when nobody selected has the label", () => {
    expect(bulkLabelState(selection, "Z", index)).toBe("none");
  });

  it("is none for an empty selection", () => {
    expect(bulkLabelState(new Set(), "L", index)).toBe("none");
  });
});
