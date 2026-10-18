import { describe, expect, it } from "vitest";
import {
  directoryScopeOptions,
  outsideMyGroups,
  scopeFamilies,
  scopeMembers,
  scopeValue,
  type GroupRosters,
} from "@/components/directory/scope";

const A = { id: "a", name: "Grace" };
const B = { id: "b", name: "Hope" };
const ORG = "Grace Church";

const labels = (opts: { label: string }[]) => opts.map((o) => o.label);

describe("directoryScopeOptions", () => {
  it("offers no Everyone option when the org setting is off, at both levels", () => {
    const inside = directoryScopeOptions({ memberships: [A, B], activeGroupId: "a", orgVisible: false, orgName: ORG });
    const org = directoryScopeOptions({ memberships: [A, B], activeGroupId: null, orgVisible: false, orgName: ORG });
    expect(labels(inside.options)).not.toContain(`Everyone in ${ORG}`);
    expect(labels(org.options)).not.toContain(`Everyone in ${ORG}`);
  });

  it("puts Everyone in <org> last when the setting is on", () => {
    const { options } = directoryScopeOptions({ memberships: [A, B], activeGroupId: "a", orgVisible: true, orgName: ORG });
    expect(labels(options).at(-1)).toBe(`Everyone in ${ORG}`);
    expect(options.at(-1)?.scope).toEqual({ kind: "org" });
  });

  it("inside a group: This group first and default, other groups in membership order, then All my groups", () => {
    const { options, defaultScope } = directoryScopeOptions({
      memberships: [A, B],
      activeGroupId: "b",
      orgVisible: false,
      orgName: ORG,
    });
    expect(labels(options)).toEqual(["This group", "Grace", "All my groups"]);
    expect(options[0].scope).toEqual({ kind: "group", groupId: "b" });
    expect(defaultScope).toEqual({ kind: "group", groupId: "b" });
  });

  it("at the org level: All my groups first and default, then each group", () => {
    const { options, defaultScope } = directoryScopeOptions({
      memberships: [A, B],
      activeGroupId: null,
      orgVisible: false,
      orgName: ORG,
    });
    expect(labels(options)).toEqual(["All my groups", "Grace", "Hope"]);
    expect(defaultScope).toEqual({ kind: "mine" });
  });

  it("hides the control for one membership with the setting off, at both levels", () => {
    const inside = directoryScopeOptions({ memberships: [A], activeGroupId: "a", orgVisible: false, orgName: ORG });
    const org = directoryScopeOptions({ memberships: [A], activeGroupId: null, orgVisible: false, orgName: ORG });
    expect(inside.options).toHaveLength(1);
    expect(inside.showControl).toBe(false);
    expect(org.options).toHaveLength(1);
    expect(org.showControl).toBe(false);
  });

  it("shows the control for one membership once the setting is on", () => {
    const { options, showControl } = directoryScopeOptions({
      memberships: [A],
      activeGroupId: "a",
      orgVisible: true,
      orgName: ORG,
    });
    expect(labels(options)).toEqual(["This group", `Everyone in ${ORG}`]);
    expect(showControl).toBe(true);
  });

  it("with no memberships: hidden when off, two options when on", () => {
    const off = directoryScopeOptions({ memberships: [], activeGroupId: null, orgVisible: false, orgName: ORG });
    const on = directoryScopeOptions({ memberships: [], activeGroupId: null, orgVisible: true, orgName: ORG });
    expect(off.showControl).toBe(false);
    expect(labels(on.options)).toEqual(["All my groups", `Everyone in ${ORG}`]);
  });

  it("serialises scopes as group:<id>, mine, org", () => {
    expect(scopeValue({ kind: "group", groupId: "a" })).toBe("group:a");
    expect(scopeValue({ kind: "mine" })).toBe("mine");
    expect(scopeValue({ kind: "org" })).toBe("org");
  });
});

const rosters: GroupRosters = {
  a: new Set(["p1", "p2"]),
  b: new Set(["p2", "p3"]),
};
const mine = ["a", "b"];
const people = [{ id: "p1" }, { id: "p2" }, { id: "p3" }, { id: "p4" }];

describe("scopeMembers", () => {
  it("a group scope keeps only that roster", () => {
    expect(scopeMembers(people, { kind: "group", groupId: "a" }, rosters, mine).map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("all my groups is the de-duplicated union", () => {
    expect(scopeMembers(people, { kind: "mine" }, rosters, mine).map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("the org scope keeps everyone loaded", () => {
    expect(scopeMembers(people, { kind: "org" }, rosters, mine)).toHaveLength(4);
  });

  it("an unknown group keeps nobody", () => {
    expect(scopeMembers(people, { kind: "group", groupId: "zzz" }, rosters, mine)).toEqual([]);
  });
});

describe("scopeFamilies", () => {
  const families = [
    { id: "f1", members: [{ id: "p1" }, { id: "p9" }] },
    { id: "f2", members: [{ id: "p3" }] },
    { id: "f3", members: [] },
  ];

  it("keeps a family with one in-scope member and drops one with none", () => {
    expect(scopeFamilies(families, { kind: "group", groupId: "a" }, rosters, mine).map((f) => f.id)).toEqual(["f1"]);
    expect(scopeFamilies(families, { kind: "mine" }, rosters, mine).map((f) => f.id)).toEqual(["f1", "f2"]);
  });

  it("the org scope keeps every family, including one with no account holders", () => {
    expect(scopeFamilies(families, { kind: "org" }, rosters, mine)).toHaveLength(3);
  });
});

describe("outsideMyGroups", () => {
  it("is true only in the org scope for a person who shares no group", () => {
    expect(outsideMyGroups({ kind: "org" }, "p4", rosters, mine)).toBe(true);
    expect(outsideMyGroups({ kind: "org" }, "p1", rosters, mine)).toBe(false);
    expect(outsideMyGroups({ kind: "mine" }, "p4", rosters, mine)).toBe(false);
    expect(outsideMyGroups({ kind: "group", groupId: "a" }, "p4", rosters, mine)).toBe(false);
  });
});
