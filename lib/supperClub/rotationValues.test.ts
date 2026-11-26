import { describe, expect, it } from "vitest";
import { changeRotation, endsOnOf, NEW_ROTATION, nextRotationValues, valuesFromRotation, type RotationDraft } from "./rotationValues";

const ended = {
  title: "Winter 2026",
  format: "same_table_rotating" as const,
  starts_on: "2027-01-01",
  ends_on: "2027-04-30",
  length_months: null,
  repeat_kind: "monthly_weekday",
  repeat_weeks: null,
  repeat_week_of_month: 3,
  weekday: 5,
  default_start_time: "18:30:00",
  table_size_min: 5,
  table_size_max: 7,
  signup_closes_on: "2026-12-20",
  allow_back_to_back_hosting: false,
  bring_list_enabled: false,
};

describe("nextRotationValues", () => {
  it("copies the format, how often, table size and settings, and starts after the ended rotation", () => {
    const next = nextRotationValues(ended);
    const dated = { title: "", startsOn: "2027-05-01", endsOn: "2027-08-28", closesOn: "" };
    expect(next).toEqual({ ...valuesFromRotation(ended), ...dated });
    expect(next).toMatchObject({ format: "same_table_rotating", repeatKind: "monthly_weekday", weekOfMonth: "3", bringList: false });
  });

  it("keeps the number of months for a rotation set by months", () => {
    const next = nextRotationValues({ ...ended, length_months: 4, repeat_kind: "weeks", repeat_weeks: 3 });
    expect(next).toMatchObject({ lengthMode: "months", lengthMonths: "4", repeatKind: "weeks", repeatWeeks: "3" });
  });
});

describe("changeRotation", () => {
  const fresh: RotationDraft = { values: { ...NEW_ROTATION, lengthMode: "end" }, titleFollowsDates: true };
  const apply = (draft: RotationDraft, ...changes: [keyof RotationDraft["values"], string][]) =>
    changes.reduce((d, [key, value]) => changeRotation(d, key, value as never, []), draft);

  it("fills the title from the dates until the leader types one", () => {
    let draft = apply(fresh, ["startsOn", "2026-09-07"], ["endsOn", "2026-11-23"]);
    expect(draft.values.title).toBe("Fall 2026");
    draft = apply(draft, ["endsOn", "2026-12-14"]);
    expect(draft.values.title).toBe("Sep – Dec 2026");
    draft = apply(draft, ["title", "Harvest suppers"], ["endsOn", "2026-11-23"], ["startsOn", "2026-10-03"]);
    expect(draft.values.title).toBe("Harvest suppers");
  });

  it("never touches a saved title on the edit form", () => {
    const editing: RotationDraft = { values: { ...fresh.values, title: "Fall 2026" }, titleFollowsDates: false };
    expect(apply(editing, ["endsOn", "2027-01-30"]).values.title).toBe("Fall 2026");
  });

  it("follows the dates again once the leader empties the title", () => {
    const draft = apply(fresh, ["startsOn", "2026-09-07"], ["endsOn", "2026-11-23"], ["title", "Mine"], ["title", " "]);
    expect(draft.values.title).toBe(" ");
    expect(apply(draft, ["endsOn", "2026-12-14"]).values.title).toBe("Sep – Dec 2026");
  });

  it("uses the end a length in months gives", () => {
    const months: RotationDraft = { values: NEW_ROTATION, titleFollowsDates: true };
    const draft = apply(months, ["startsOn", "2026-09-07"], ["lengthMonths", "3"]);
    expect(endsOnOf(draft.values)).toBe("2026-12-06");
    expect(draft.values.title).toBe("Sep – Dec 2026");
  });

  it("avoids a title another rotation of the group has", () => {
    const draft = changeRotation(apply(fresh, ["startsOn", "2026-09-07"]), "endsOn", "2026-11-23", ["Fall 2026"]);
    expect(draft.values.title).toBe("Sep – Nov 2026");
  });

  it("avoids the group's other titles once an edited title is emptied", () => {
    const saved = { ...fresh.values, title: "Harvest suppers", startsOn: "2026-09-07", endsOn: "2026-12-14" };
    const emptied = changeRotation({ values: saved, titleFollowsDates: false }, "title", "", ["Fall 2026"]);
    expect(changeRotation(emptied, "endsOn", "2026-11-23", ["Fall 2026"]).values.title).toBe("Sep – Nov 2026");
  });

  it("has no end yet while the start is empty", () => {
    expect(endsOnOf(NEW_ROTATION)).toBe("");
  });

  it("has no end for a month count past the longest rotation, rather than throwing", () => {
    const months: RotationDraft = { values: NEW_ROTATION, titleFollowsDates: true };
    const draft = apply(months, ["startsOn", "2026-09-07"], ["lengthMonths", "9999999"]);
    expect(endsOnOf(draft.values)).toBe("");
    expect(endsOnOf({ ...draft.values, lengthMonths: "24" })).toBe("2028-09-06");
  });
});
