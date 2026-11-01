import { describe, expect, it } from "vitest";
import { overviewNeeds } from "./overviewNeeds";

describe("overviewNeeds", () => {
  it("says nothing is waiting and offers no action when the queues are empty", () => {
    const needs = overviewNeeds({
      accessRequests: 0,
      groupRequests: 0,
      joinRequests: 0,
      joinSummary: "No pending join requests.",
    });
    expect(needs.map((n) => n.summary)).toEqual([
      "No requests waiting.",
      "No requests waiting.",
      "No pending join requests.",
    ]);
    expect(needs.every((n) => n.action === undefined)).toBe(true);
  });

  it("counts each queue and links to where it is reviewed", () => {
    const [access, group, join] = overviewNeeds({
      accessRequests: 2,
      groupRequests: 1,
      joinRequests: 1,
      joinSummary: "1 join request waiting.",
    });
    expect(access.summary).toBe("2 requests waiting.");
    expect(access.action?.href).toBe("/admin/members?tab=requests");
    expect(group.summary).toBe("1 request waiting.");
    expect(group.action?.href).toBe("/admin/groups");
    expect(join.action?.label).toBe("Review join requests");
  });
});
