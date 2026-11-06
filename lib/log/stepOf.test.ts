import { describe, expect, it } from "vitest";
import { formatLine, stepOf } from "./core";

describe("stepOf", () => {
  it.each([
    ["group requests", "group_requests"],
    ["event-images", "event_images"],
    ["  Household entries! ", "household_entries"],
  ])("shapes the label %j as %s, which the log line accepts", (label, step) => {
    expect(stepOf(label)).toBe(step);
    expect(JSON.parse(formatLine("error", "x", undefined, { step: stepOf(label) }, "REF")).step).toBe(step);
  });
});
