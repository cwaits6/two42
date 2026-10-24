import { describe, expect, it } from "vitest";
import {
  JOIN_POLICIES,
  JOIN_POLICY_OPTIONS,
  NO_PENDING_TEXT,
  OPEN_POLICY_EMPTY_TEXT,
  discoveryRowSubtitle,
  joinErrorMessage,
  joinRowState,
  memberCountLabel,
  parseJoinPolicy,
  pendingRequestsEmptyText,
  privacyHelperText,
  toDiscoverableGroup,
  type DiscoverableGroup,
} from "@/lib/groups/joining";

const base: DiscoverableGroup = {
  id: "g1",
  name: "Grace",
  description: null,
  member_count: 3,
  is_private: false,
  join_policy: "approval",
  viewer_role: null,
  request_status: null,
};

describe("parseJoinPolicy", () => {
  it.each(JOIN_POLICIES)("passes %s through", (policy) => {
    expect(parseJoinPolicy(policy)).toBe(policy);
  });

  it.each([null, undefined, "invite", 42, ""])("falls back to approval for %p", (raw) => {
    expect(parseJoinPolicy(raw)).toBe("approval");
  });
});

describe("toDiscoverableGroup", () => {
  it("narrows the raw RPC row to the typed shape", () => {
    expect(
      toDiscoverableGroup({
        id: "g1",
        name: "Grace",
        description: "Thursdays, 7 pm",
        member_count: 2,
        is_private: true,
        join_policy: "open",
        viewer_role: "leader",
        request_status: "pending",
      }),
    ).toEqual({
      id: "g1",
      name: "Grace",
      description: "Thursdays, 7 pm",
      member_count: 2,
      is_private: true,
      join_policy: "open",
      viewer_role: "leader",
      request_status: "pending",
    });
  });

  it("treats an unknown role, status or policy as none", () => {
    const row = toDiscoverableGroup({
      ...base,
      join_policy: "invite",
      viewer_role: "owner",
      request_status: "declined",
    });
    expect(row.join_policy).toBe("approval");
    expect(row.viewer_role).toBeNull();
    expect(row.request_status).toBeNull();
  });
});

describe("joinRowState", () => {
  it.each([
    ["a group the viewer leads", { viewer_role: "leader" }, "leads"],
    ["a group the viewer is in", { viewer_role: "member" }, "member"],
    ["a private group the viewer leads is still theirs", { viewer_role: "leader", is_private: true }, "leads"],
    ["a private row without a role is the admin tag", { is_private: true }, "private"],
    ["a private open group still shows the tag, never Join", { is_private: true, join_policy: "open" }, "private"],
    ["an open group", { join_policy: "open" }, "join"],
    ["open policy wins over a stale pending request", { join_policy: "open", request_status: "pending" }, "join"],
    ["an approval group with a pending request", { request_status: "pending" }, "requested"],
    ["an approval group with no request", {}, "request"],
  ] as const)("%s", (_label, overrides, expected) => {
    expect(joinRowState({ ...base, ...overrides })).toBe(expected);
  });
});

describe("JOIN_POLICY_OPTIONS", () => {
  it("offers exactly the two policies, approval first", () => {
    expect(JOIN_POLICY_OPTIONS.map((o) => o.value)).toEqual(["approval", "open"]);
    expect(JOIN_POLICY_OPTIONS.map((o) => o.label)).toEqual(["Approval required", "Open"]);
  });
});

describe("memberCountLabel", () => {
  it.each([
    [0, "0 members"],
    [1, "1 member"],
    [2, "2 members"],
  ])("%d → %s", (count, label) => {
    expect(memberCountLabel(count)).toBe(label);
  });
});

describe("discoveryRowSubtitle", () => {
  it("is the count alone without a meeting time", () => {
    expect(discoveryRowSubtitle({ member_count: 1, description: null })).toBe("1 member");
  });

  it("appends the meeting time after the count", () => {
    expect(discoveryRowSubtitle({ member_count: 4, description: "Thursdays, 7 pm" })).toBe(
      "4 members · Thursdays, 7 pm",
    );
  });
});

describe("privacyHelperText", () => {
  it("names the org setting as the ceiling while discovery is on", () => {
    expect(privacyHelperText(true)).toContain("ceiling");
    expect(privacyHelperText(true)).toContain("never less");
  });

  it("says the group is already hidden while discovery is off", () => {
    expect(privacyHelperText(false)).toMatch(/^Already hidden/);
  });
});

describe("pendingRequestsEmptyText", () => {
  it("explains the open policy when the list is empty", () => {
    expect(pendingRequestsEmptyText("open")).toBe(OPEN_POLICY_EMPTY_TEXT);
  });

  it("is a plain empty line under approval", () => {
    expect(pendingRequestsEmptyText("approval")).toBe(NO_PENDING_TEXT);
  });
});

describe("joinErrorMessage", () => {
  it.each([
    ["GJ001", "This group isn't open to join."],
    ["GJ002", "Your account can't join groups yet."],
    ["GJ003", "You're already in this group."],
    ["GJ004", "That request is no longer pending."],
  ])("%s → %s", (code, message) => {
    expect(joinErrorMessage(code)).toBe(message);
  });

  it.each([undefined, "", "PGRST301", "GC001"])("falls back for %p", (code) => {
    expect(joinErrorMessage(code)).toBe("Couldn't update your membership. Please try again.");
  });
});
