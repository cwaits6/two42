import { describe, expect, it } from "vitest";
import {
  filterMemberRows,
  memberActions,
  statusCounts,
  toMemberRows,
  type RoleFilter,
  type StatusFilter,
} from "./memberRows";

const profile = (id: string, first: string, last: string, role: "admin" | "member" | "pending") => ({
  id,
  first_name: first,
  last_name: last,
  preferred_name: null,
  email: `${first.toLowerCase()}@example.test`,
  role,
});

const rows = toMemberRows(
  [
    profile("p1", "Zoe", "Able", "admin"),
    profile("p2", "Ben", "Young", "member"),
    profile("p3", "Cy", "Park", "pending"),
    profile("p4", "Ben", "Able", "member"),
  ],
  [{ id: "r1", name: "Dee Marsh", email: "dee@example.test" }],
);

describe("toMemberRows", () => {
  it("sorts invited people in among members by the name shown", () => {
    expect(rows.map((r) => r.name)).toEqual(["Ben Able", "Ben Young", "Cy Park", "Dee Marsh", "Zoe Able"]);
  });

  it("gives a role only to someone approved, and a status to everyone else", () => {
    expect(rows.map((r) => [r.role, r.status])).toEqual([
      ["member", null],
      ["member", null],
      [null, "pending"],
      [null, "invited"],
      ["admin", null],
    ]);
  });
});

describe("filterMemberRows", () => {
  const names = (filters: { query?: string; role?: RoleFilter; status?: StatusFilter }) =>
    filterMemberRows(rows, { query: "", role: "all", status: "all", ...filters }).map((r) => r.name);

  it("combines search with the role and status filters", () => {
    expect(names({ query: "ben", role: "member" })).toEqual(["Ben Able", "Ben Young"]);
    expect(names({ query: "able", role: "admin" })).toEqual(["Zoe Able"]);
    expect(names({ query: "dee@", status: "invited" })).toEqual(["Dee Marsh"]);
    expect(names({ query: "ben", status: "pending" })).toEqual([]);
  });

  it("leaves people with no role out of a role filter", () => {
    expect(names({ role: "member" })).toEqual(["Ben Able", "Ben Young"]);
    expect(names({ role: "member", status: "pending" })).toEqual([]);
  });
});

describe("statusCounts", () => {
  it("counts, for every tab, exactly the rows that tab shows", () => {
    for (const query of ["", "ben", "example.test", "nobody"]) {
      for (const role of ["all", "member", "admin"] as const) {
        const counts = statusCounts(rows, { query, role });
        for (const status of ["all", "invited", "pending"] as const) {
          expect(counts[status]).toBe(filterMemberRows(rows, { query, role, status }).length);
        }
      }
    }
    expect(statusCounts(rows, { query: "", role: "all" })).toEqual({ all: 5, invited: 1, pending: 1 });
  });
});

describe("memberActions", () => {
  const row = (name: string) => rows.find((r) => r.name === name)!;

  it("offers the viewer's own row nothing but Edit", () => {
    expect(memberActions(row("Zoe Able"), "p1")).toEqual(["edit"]);
  });

  it("offers every action on someone else, without a second move to pending", () => {
    expect(memberActions(row("Ben Young"), "p1")).toEqual(["edit", "pending", "delete"]);
    expect(memberActions(row("Cy Park"), "p1")).toEqual(["edit", "delete"]);
  });

  it("offers Edit only on every row when the viewer is unknown, since any row could be theirs", () => {
    expect(memberActions(row("Zoe Able"), null)).toEqual(["edit"]);
    expect(memberActions(row("Ben Young"), null)).toEqual(["edit"]);
    expect(memberActions(row("Cy Park"), null)).toEqual(["edit"]);
    expect(memberActions(row("Dee Marsh"), null)).toEqual([]);
  });

  it("offers nothing on an invite, which has no account", () => {
    expect(memberActions(row("Dee Marsh"), "p1")).toEqual([]);
  });
});
