import { describe, expect, it } from "vitest";
import { choicesFor, refreshMessage, settingsBody } from "./copyFields";

describe("choicesFor", () => {
  it.each(["phone_mobile", "phone_work", "birthday", "anniversary", "photo", "address", "phone_home"] as const)("offers no lock for %s", (field) => {
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

describe("refreshMessage", () => {
  const none = { copied: 0, pending: 0, failed: 0, photosSkipped: 0, householdsUnavailable: false, stoppedAtBudget: false };

  it("reports a clean refresh as done", () => {
    expect(refreshMessage(none)).toEqual({ tone: "success", text: "Refreshed. Nothing needed updating." });
    expect(refreshMessage({ ...none, copied: 2 }).text).toBe("Refreshed. Updated 2 people.");
  });

  it.each([
    [{ failed: 3 }, "3 people couldn't be copied."],
    [{ pending: 1 }, "1 person still to copy"],
    [{ photosSkipped: 2 }, "2 photos couldn't be used"],
    [{ householdsUnavailable: true }, "households weren't refreshed"],
    [{ stoppedAtBudget: true }, "Households weren't all refreshed; the next refresh carries on."],
  ])("warns when %j", (counts, text) => {
    const message = refreshMessage({ ...none, ...counts });
    expect(message.tone).toBe("warning");
    expect(message.text).toContain(text);
  });
});
