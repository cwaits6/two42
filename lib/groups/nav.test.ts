import { describe, expect, it } from "vitest";
import type { ActiveGroup } from "@/lib/groups/active";
import { GROUP_DEFAULT_COLOR } from "@/lib/groups/calendar";
import { buildSidebar, type SidebarInput, type SidebarItem } from "@/lib/groups/nav";

const A_ID = "11111111-1111-4111-8111-111111111111";
const B_ID = "22222222-2222-4222-8222-222222222222";

const A: ActiveGroup = { id: A_ID, name: "Grace Fellowship", color: GROUP_DEFAULT_COLOR, role: "leader" };
const B: ActiveGroup = { id: B_ID, name: "Hope", color: GROUP_DEFAULT_COLOR, role: "member" };

const base: SidebarInput = {
  memberships: [],
  activeGroup: null,
  discoveryOn: false,
  isLeader: false,
  hasServingAccess: false,
  orgName: "Grace Church",
};

function input(overrides: Partial<SidebarInput>): SidebarInput {
  return { ...base, ...overrides };
}

/** Labels in render order; structural items appear as their kind in brackets. */
function outline(items: SidebarItem[]): string[] {
  return items.map((item) => {
    switch (item.kind) {
      case "link":
        return `${item.label} ${item.href}${item.quiet ? " (quiet)" : ""}`;
      case "groupBlock":
        return `[groupBlock:${item.mode}]`;
      case "gap":
        return "[gap]";
      case "separator":
        return "[separator]";
    }
  });
}

function block(items: SidebarItem[]) {
  const found = items.find((i) => i.kind === "groupBlock");
  if (found?.kind !== "groupBlock") throw new Error("expected a group block");
  return found;
}

const FIND = "Find a group /find-a-group (quiet)";

/** A group's pages, given where its Home, Calendar and Directory live. */
function pages(id: string, churchBase: string, opts: { serving: boolean; leader: boolean }): string[] {
  return [
    `Home ${churchBase}/dashboard`,
    `Calendar ${churchBase}/calendar`,
    `Announcements /g/${id}/announcements`,
    "[gap]",
    `Prayer /g/${id}/prayer`,
    `Lessons /g/${id}/lectures`,
    ...(opts.serving ? [`Serving /g/${id}/serving`] : []),
    "[gap]",
    `Directory ${churchBase}/directory`,
    `Give /g/${id}/give`,
    `About /g/${id}/about`,
    ...(opts.leader ? ["[separator]", `Group settings /g/${id}/settings`] : []),
  ];
}

const FLAGS = [false, true].flatMap((leader) =>
  [false, true].flatMap((serving) =>
    [false, true].map((finding) => ({ leader, serving, finding }))
  )
);
const flagTitle = "leader $leader, Serving $serving, finding groups $finding";

describe("buildSidebar: no group", () => {
  it("shows Home alone with finding groups off", () => {
    expect(outline(buildSidebar(input({})))).toEqual(["Home /dashboard"]);
  });

  it("adds a quiet Find a group with finding groups on", () => {
    expect(outline(buildSidebar(input({ discoveryOn: true })))).toEqual(["Home /dashboard", "[gap]", FIND]);
  });
});

describe("buildSidebar: one group", () => {
  it.each(FLAGS)(flagTitle, ({ leader, serving, finding }) => {
    const items = buildSidebar(
      input({
        memberships: [A],
        activeGroup: A,
        isLeader: leader,
        hasServingAccess: serving,
        discoveryOn: finding,
      })
    );
    expect(outline(items)).toEqual([
      "[groupBlock:static]",
      ...pages(A_ID, "", { serving, leader }),
      ...(finding ? ["[gap]", FIND] : []),
    ]);
  });

  it("names the group in a block that never opens, whatever the finding groups setting", () => {
    for (const discoveryOn of [false, true]) {
      expect(block(buildSidebar(input({ memberships: [A], activeGroup: A, discoveryOn })))).toMatchObject({
        mode: "static",
        group: A,
        orgName: "Grace Church",
        initials: "GF",
        rows: [],
        findAGroupFooter: false,
      });
    }
  });
});

describe("buildSidebar: two or more groups, church level", () => {
  const two = { memberships: [A, B], activeGroup: null };

  it.each([false, true])("lists the church's pages under an All groups switcher, finding groups %s", (finding) => {
    const items = buildSidebar(input({ ...two, discoveryOn: finding, isLeader: true, hasServingAccess: true }));
    expect(outline(items)).toEqual([
      "[groupBlock:switcher]",
      "Home /dashboard",
      "Calendar /calendar",
      "[gap]",
      "Directory /directory",
    ]);
    const switcher = block(items);
    expect(switcher).toMatchObject({ group: null, initials: "", findAGroupFooter: finding });
    expect(switcher.rows.map((r) => [r.group.id, r.current])).toEqual([
      [A_ID, false],
      [B_ID, false],
    ]);
  });
});

describe("buildSidebar: two or more groups, inside a group", () => {
  it.each(FLAGS)(flagTitle, ({ leader, serving, finding }) => {
    const items = buildSidebar(
      input({
        memberships: [A, B],
        activeGroup: B,
        isLeader: leader,
        hasServingAccess: serving,
        discoveryOn: finding,
      })
    );
    expect(outline(items)).toEqual([
      "[groupBlock:switcher]",
      ...pages(B_ID, `/g/${B_ID}`, { serving, leader }),
    ]);
    expect(block(items).findAGroupFooter).toBe(finding);
  });

  it("builds one switcher row per membership, marks the current one, and keeps the page on switch", () => {
    const switcher = block(buildSidebar(input({ memberships: [A, B], activeGroup: B })));
    expect(switcher.mode).toBe("switcher");
    expect(switcher.allGroupsHref).toBe("/dashboard");
    expect(switcher.rows.map((r) => [r.group.id, r.current])).toEqual([
      [A_ID, false],
      [B_ID, true],
    ]);
    expect(switcher.rows[0].href(`/g/${B_ID}/directory`)).toBe(`/g/${A_ID}/directory`);
    expect(switcher.rows[0].href(`/g/${B_ID}/calendar/evt-1`)).toBe(`/g/${A_ID}/calendar`);
  });
});

describe("buildSidebar: every state", () => {
  const memberStates = [
    { memberships: [], activeGroup: null },
    { memberships: [A], activeGroup: A },
    { memberships: [A, B], activeGroup: null },
    { memberships: [A, B], activeGroup: B },
  ];
  const states = memberStates.flatMap((state) =>
    FLAGS.map(({ leader, serving, finding }) =>
      input({ ...state, isLeader: leader, hasServingAccess: serving, discoveryOn: finding })
    )
  );

  it("never shows two links with the same label", () => {
    for (const state of states) {
      const labels = buildSidebar(state).flatMap((i) => (i.kind === "link" ? [i.label] : []));
      expect(new Set(labels).size, labels.join(", ")).toBe(labels.length);
    }
  });

  it("offers Find a group in exactly one place when finding groups is on, and nowhere when off", () => {
    for (const state of states) {
      const items = buildSidebar(state);
      const rows = items.filter((i) => i.kind === "link" && i.href === "/find-a-group").length;
      const footers = items.filter((i) => i.kind === "groupBlock" && i.findAGroupFooter).length;
      expect(rows + footers).toBe(state.discoveryOn ? 1 : 0);
    }
  });

  it("lists Directory once, with no sub-menu of the directory's tabs", () => {
    for (const state of states.filter((s) => s.memberships.length > 0)) {
      const entries = outline(buildSidebar(state)).filter((line) => line.includes("/directory"));
      expect(entries).toHaveLength(1);
    }
  });
});

describe("buildSidebar: the Group settings count", () => {
  const settingsRow = (items: SidebarItem[]) =>
    items.find((i) => i.kind === "link" && i.label === "Group settings") as
      | Extract<SidebarItem, { kind: "link" }>
      | undefined;

  it("carries the waiting count on a leader's Group settings row", () => {
    const items = buildSidebar(input({ memberships: [A, B], activeGroup: A, isLeader: true, waitingRequests: 2 }));
    expect(settingsRow(items)?.count).toBe(2);
  });

  it("has no count at zero or when it couldn't be counted", () => {
    for (const waitingRequests of [0, null, undefined]) {
      const items = buildSidebar(input({ memberships: [A], activeGroup: A, isLeader: true, waitingRequests }));
      expect(settingsRow(items)).toBeDefined();
      expect(settingsRow(items)).not.toHaveProperty("count");
    }
  });

  it("gives a member no Group settings row whatever the count", () => {
    const items = buildSidebar(input({ memberships: [A, B], activeGroup: B, isLeader: false, waitingRequests: 4 }));
    expect(settingsRow(items)).toBeUndefined();
  });
});
