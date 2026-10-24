import { describe, expect, it } from "vitest";
import {
  NO_PENDING_JOIN_REQUESTS_TEXT,
  groupPendingJoinRequests,
  pendingJoinRequestsSummary,
  requestedOn,
  toPendingJoinRequest,
  type PendingJoinRequest,
} from "@/lib/groups/joinQueue";

const groupA = { id: "a", name: "Group A" };
const groupC = { id: "c", name: "Group C" };

function request(id: string, group: { id: string; name: string }): PendingJoinRequest {
  return {
    id,
    created_at: "2026-10-20T10:00:00Z",
    requester: { first_name: "Isaac", last_name: "Seedly", preferred_name: null },
    email: null,
    group,
  };
}

describe("toPendingJoinRequest", () => {
  it("tags the function's row with the group it was read for", () => {
    const row = toPendingJoinRequest(groupA, {
      id: "r1",
      created_at: "2026-10-20T10:00:00Z",
      first_name: "Daniel",
      last_name: "Seedly",
      preferred_name: "Danny",
      email: "danny@example.test",
    });
    expect(row).toEqual({
      id: "r1",
      created_at: "2026-10-20T10:00:00Z",
      requester: { first_name: "Daniel", last_name: "Seedly", preferred_name: "Danny" },
      email: "danny@example.test",
      group: groupA,
    });
  });

  it("keeps a hidden email null rather than empty", () => {
    const row = toPendingJoinRequest(groupA, {
      id: "r1",
      created_at: "2026-10-20T10:00:00Z",
      first_name: null,
      last_name: null,
      preferred_name: null,
      email: null,
    });
    expect(row.email).toBeNull();
    expect(row.requester).toEqual({ first_name: null, last_name: null, preferred_name: null });
  });
});

describe("groupPendingJoinRequests", () => {
  it("is empty when nothing is waiting", () => {
    expect(groupPendingJoinRequests([])).toEqual([]);
  });

  it("makes one section per group, in first-seen order, keeping request order", () => {
    const rows = [request("1", groupC), request("2", groupA), request("3", groupC)];
    expect(groupPendingJoinRequests(rows)).toEqual([
      { group: groupC, requests: [rows[0], rows[2]] },
      { group: groupA, requests: [rows[1]] },
    ]);
  });

  it("drops a group's section once its last request is gone", () => {
    const rows = [request("1", groupA), request("2", groupC)];
    const remaining = rows.filter((r) => r.id !== "1");
    expect(groupPendingJoinRequests(remaining).map((s) => s.group.id)).toEqual(["c"]);
  });
});

describe("pendingJoinRequestsSummary", () => {
  it("says so when the queue is empty", () => {
    expect(pendingJoinRequestsSummary(0)).toBe(NO_PENDING_JOIN_REQUESTS_TEXT);
  });

  it.each([
    [1, "1 join request waiting."],
    [2, "2 join requests waiting."],
    [12, "12 join requests waiting."],
  ])("counts %i", (count, text) => {
    expect(pendingJoinRequestsSummary(count)).toBe(text);
  });
});

describe("requestedOn", () => {
  it("renders the org's calendar day, not the server's", () => {
    // 03:30Z on the 21st is still the evening of the 20th in New York.
    expect(requestedOn("2026-10-21T03:30:00Z", "America/New_York")).toBe("Oct 20, 2026");
    expect(requestedOn("2026-10-21T03:30:00Z", "UTC")).toBe("Oct 21, 2026");
  });
});
