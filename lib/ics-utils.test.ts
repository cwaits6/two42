import { describe, expect, it } from "vitest";
import { eventToICSAttributes, servingToICSAttributes } from "@/lib/ics-utils";
import type { Event } from "@/lib/types";

const event = {
  id: "e1",
  group_id: "g1",
  title: "Potluck",
  description: null,
  location: null,
  start_time: "2026-10-20T18:00:00Z",
  end_time: null,
} as Event;

describe("summary prefix", () => {
  it("prefixes an event title with the group name on the merged feed", () => {
    expect(eventToICSAttributes(event, { summaryPrefix: "Grace" }).title).toBe("Grace: Potluck");
  });

  it("leaves an event title alone without a prefix", () => {
    expect(eventToICSAttributes(event).title).toBe("Potluck");
  });

  it("prefixes a serving signup with the group name on the merged feed", () => {
    expect(
      servingToICSAttributes({
        signupId: "s1",
        serviceDate: "2026-10-25",
        teamName: "Greeters",
        summaryPrefix: "Grace",
      }).title
    ).toBe("Grace: Serving: Greeters");
  });

  it("leaves a serving signup alone without a prefix", () => {
    expect(
      servingToICSAttributes({ signupId: "s1", serviceDate: "2026-10-25", teamName: "Greeters" }).title
    ).toBe("Serving: Greeters");
  });
});
