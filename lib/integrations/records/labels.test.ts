import { describe, expect, it } from "vitest";
import { changeableFilled, isLocked, type ProfileRecords, recordsLabel } from "./labels";

const records: ProfileRecords = {
  settings: { name: "locked", phone_mobile: "member", birthday: "member", photo: "member", title: "locked" },
  values: {
    name: { state: "records", churchValue: { first_name: "Ada", last_name: "Lovelace" } },
    preferred_name: { state: "records", churchValue: { preferred_name: "Addie" } },
    phone_mobile: { state: "records", churchValue: { phone_mobile: "+15125550199" } },
    birthday: { state: "cleared", churchValue: { birth_month: 12, birth_day: 10, birth_year: null } },
    photo: { state: "changed", churchValue: { photo: "77", avatar_url: null } },
  },
  noticeDue: true,
};

describe("recordsLabel", () => {
  it("locks a locked field only for a person whose value came from the records", () => {
    expect(isLocked(records, "name")).toBe(true);
    expect(isLocked(records, "title")).toBe(false);
    expect(isLocked(null, "name")).toBe(false);
  });

  it("never locks the preferred name", () => {
    expect(recordsLabel({ ...records, settings: { ...records.settings } }, "preferred_name")).toEqual({ kind: "records" });
  });

  it("offers the church's value back after a clear", () => {
    expect(recordsLabel(records, "birthday")).toEqual({
      kind: "changed",
      churchValue: { birth_month: 12, birth_day: 10, birth_year: null },
    });
  });

  it("offers no church photo it hasn't stored", () => {
    expect(recordsLabel(records, "photo")).toEqual({ kind: "changed", churchValue: null });
  });
});

describe("changeableFilled", () => {
  it("lists the filled details the member may change, never a locked one", () => {
    expect(changeableFilled(records).map((f) => f.label)).toEqual(["Preferred name", "Mobile phone"]);
  });
});
