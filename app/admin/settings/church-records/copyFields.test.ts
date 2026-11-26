import { describe, expect, it } from "vitest";
import { choicesFor, settingsBody } from "./copyFields";

describe("choicesFor", () => {
  it.each(["phone_mobile", "phone_work", "birthday", "anniversary", "photo"] as const)("offers no lock for %s", (field) => {
    expect(choicesFor(field).map((c) => c.label)).toEqual([
      "Not from your church's records",
      "From them, member can change",
    ]);
  });

  it.each(["name", "suffix", "title", "gender", "grade"] as const)("offers every setting for %s", (field) => {
    expect(choicesFor(field).map((c) => c.label)).toEqual([
      "Not from your church's records",
      "From them, locked",
      "From them, member can change",
    ]);
  });
});

describe("settingsBody", () => {
  it("leaves out a field that is not from the records", () => {
    expect(settingsBody({ name: "locked", phone_mobile: "off", photo: "member" })).toEqual({ name: "locked", photo: "member" });
  });
});
