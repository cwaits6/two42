import { describe, expect, it } from "vitest";
import { GROUP_DEFAULT_COLOR, type ActiveGroup } from "@/lib/groups/active";
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
  isOrgAdmin: false,
  isContentEditor: false,
  hasServingAccess: true,
  collapsed: false,
  phone: false,
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
        return `${item.label} ${item.href}`;
      case "directory":
        return `Directory ${item.href}`;
      case "groupBlock":
        return `[groupBlock:${item.mode}]`;
      case "yourGroups":
        return `[yourGroups:${item.rows.length}]`;
      case "separator":
        return "[separator]";
    }
  });
}

const ACCOUNT = ["[separator]", "My Profile /profile", "Settings /settings"];
const ADMIN = ["[separator]", "Admin /admin"];

describe("buildSidebar — no group", () => {
  it("shows Home and Account only with discovery off", () => {
    const model = buildSidebar(input({}));
    expect(outline(model.items)).toEqual(["Home /dashboard", ...ACCOUNT]);
    expect(model.phonePill).toBeNull();
  });

  it("adds Find a group with discovery on", () => {
    const model = buildSidebar(input({ discoveryOn: true }));
    expect(outline(model.items)).toEqual([
      "Home /dashboard",
      "Find a group /find-a-group",
      ...ACCOUNT,
    ]);
  });

  it("adds Admin for an org admin and for a content editor", () => {
    expect(outline(buildSidebar(input({ isOrgAdmin: true })).items)).toEqual([
      "Home /dashboard",
      ...ACCOUNT,
      ...ADMIN,
    ]);
    expect(outline(buildSidebar(input({ isContentEditor: true })).items)).toEqual([
      "Home /dashboard",
      ...ACCOUNT,
      ...ADMIN,
    ]);
  });
});

describe("buildSidebar — one group", () => {
  const one = { memberships: [A], activeGroup: A };

  it("lists Calendar, Directory, then the group pages with no block when discovery is off", () => {
    const model = buildSidebar(input({ ...one }));
    expect(outline(model.items)).toEqual([
      "Home /dashboard",
      "Calendar /calendar",
      "Directory /directory",
      `Announcements /g/${A_ID}/announcements`,
      `Lectures /g/${A_ID}/lectures`,
      `About /g/${A_ID}/about`,
      `Serving /g/${A_ID}/serving`,
      `Prayer /g/${A_ID}/prayer`,
      `Give /g/${A_ID}/give`,
      ...ACCOUNT,
    ]);
    expect(model.items.some((i) => i.kind === "groupBlock")).toBe(false);
  });

  it("shows a static block and Find a group when discovery is on, never a switcher", () => {
    const model = buildSidebar(input({ ...one, discoveryOn: true }));
    expect(outline(model.items).slice(0, 4)).toEqual([
      "Home /dashboard",
      "[groupBlock:static]",
      "Find a group /find-a-group",
      "Calendar /calendar",
    ]);
    const block = model.items.find((i) => i.kind === "groupBlock");
    expect(block).toMatchObject({
      mode: "static",
      group: A,
      orgName: "Grace Church",
      initials: "GF",
      rows: [],
      findAGroupFooter: false,
    });
  });

  it("adds Group settings only for a leader", () => {
    const member = buildSidebar(input({ ...one }));
    const leader = buildSidebar(input({ ...one, isLeader: true }));
    expect(outline(member.items)).not.toContain(`Group settings /g/${A_ID}/settings`);
    expect(outline(leader.items)).toContain(`Group settings /g/${A_ID}/settings`);
    expect(outline(leader.items).indexOf(`Group settings /g/${A_ID}/settings`)).toBe(
      outline(leader.items).indexOf(`Give /g/${A_ID}/give`) + 1
    );
  });

  it("follows hasServingAccess for the Serving entry", () => {
    const model = buildSidebar(input({ ...one, hasServingAccess: false }));
    expect(outline(model.items)).not.toContain(`Serving /g/${A_ID}/serving`);
  });

  it("never shows the phone pill", () => {
    expect(buildSidebar(input({ ...one, phone: true })).phonePill).toBeNull();
  });

  it("appends Admin after Account for an org admin", () => {
    const model = buildSidebar(input({ ...one, isOrgAdmin: true }));
    expect(outline(model.items).slice(-5)).toEqual([...ACCOUNT, ...ADMIN]);
  });
});

describe("buildSidebar — two or more groups, org level", () => {
  const two = { memberships: [A, B], activeGroup: null };

  it("shows Home, Calendar, Directory, then Your groups", () => {
    const model = buildSidebar(input({ ...two }));
    expect(outline(model.items)).toEqual([
      "Home /dashboard",
      "Calendar /calendar",
      "Directory /directory",
      "[yourGroups:2]",
      ...ACCOUNT,
    ]);
    const yourGroups = model.items.find((i) => i.kind === "yourGroups");
    expect(yourGroups).toEqual({
      kind: "yourGroups",
      rows: [
        { group: A, href: `/g/${A_ID}/dashboard` },
        { group: B, href: `/g/${B_ID}/dashboard` },
      ],
    });
  });

  it("adds Find a group after Your groups with discovery on", () => {
    const model = buildSidebar(input({ ...two, discoveryOn: true }));
    expect(outline(model.items).slice(3, 5)).toEqual([
      "[yourGroups:2]",
      "Find a group /find-a-group",
    ]);
  });

  it("shows no phone pill at the org level", () => {
    expect(buildSidebar(input({ ...two, phone: true })).phonePill).toBeNull();
  });
});

describe("buildSidebar — two or more groups, inside a group", () => {
  const inside = { memberships: [A, B], activeGroup: B };

  it("shows the switcher block, then the group's pages", () => {
    const model = buildSidebar(input({ ...inside }));
    expect(outline(model.items)).toEqual([
      "Home /dashboard",
      "[groupBlock:switcher]",
      `Dashboard /g/${B_ID}/dashboard`,
      `Calendar /g/${B_ID}/calendar`,
      `Directory /g/${B_ID}/directory`,
      `Announcements /g/${B_ID}/announcements`,
      `Lectures /g/${B_ID}/lectures`,
      `About /g/${B_ID}/about`,
      `Serving /g/${B_ID}/serving`,
      `Prayer /g/${B_ID}/prayer`,
      `Give /g/${B_ID}/give`,
      ...ACCOUNT,
    ]);
  });

  it("builds one switcher row per membership, marks the current one, and keeps the page on switch", () => {
    const model = buildSidebar(input({ ...inside }));
    const block = model.items.find((i) => i.kind === "groupBlock");
    if (block?.kind !== "groupBlock") throw new Error("expected a group block");
    expect(block.mode).toBe("switcher");
    expect(block.rows.map((r) => [r.group.id, r.current])).toEqual([
      [A_ID, false],
      [B_ID, true],
    ]);
    expect(block.rows[0].href(`/g/${B_ID}/directory`)).toBe(`/g/${A_ID}/directory`);
    expect(block.rows[0].href(`/g/${B_ID}/calendar/evt-1`)).toBe(`/g/${A_ID}/calendar`);
  });

  it("carries the Find a group footer only when discovery is on", () => {
    const off = buildSidebar(input({ ...inside })).items.find((i) => i.kind === "groupBlock");
    const on = buildSidebar(input({ ...inside, discoveryOn: true })).items.find(
      (i) => i.kind === "groupBlock"
    );
    expect(off).toMatchObject({ findAGroupFooter: false });
    expect(on).toMatchObject({ findAGroupFooter: true });
  });

  it("adds Group settings for a leader of the active group", () => {
    const model = buildSidebar(input({ memberships: [A, B], activeGroup: A, isLeader: true }));
    expect(outline(model.items)).toContain(`Group settings /g/${A_ID}/settings`);
  });

  it("shows the phone pill for the active group on the phone only", () => {
    expect(buildSidebar(input({ ...inside, phone: true })).phonePill).toEqual({ group: B });
    expect(buildSidebar(input({ ...inside, phone: false })).phonePill).toBeNull();
  });
});

describe("buildSidebar — directory children", () => {
  it("lists Members, Families, Birthdays, Anniversaries, and Groups only with discovery on", () => {
    const off = buildSidebar(input({ memberships: [A], activeGroup: A })).items.find(
      (i) => i.kind === "directory"
    );
    const on = buildSidebar(input({ memberships: [A], activeGroup: A, discoveryOn: true })).items.find(
      (i) => i.kind === "directory"
    );
    if (off?.kind !== "directory" || on?.kind !== "directory") throw new Error("expected directory");
    expect(off.children.map((c) => c.label)).toEqual([
      "Members",
      "Families",
      "Birthdays",
      "Anniversaries",
    ]);
    expect(on.children.map((c) => c.label)).toEqual([
      "Members",
      "Families",
      "Birthdays",
      "Anniversaries",
      "Groups",
    ]);
    expect(off.children[0].href).toBe("/directory");
  });

  it("prefixes the children inside a group", () => {
    const item = buildSidebar(input({ memberships: [A, B], activeGroup: B })).items.find(
      (i) => i.kind === "directory"
    );
    if (item?.kind !== "directory") throw new Error("expected directory");
    expect(item.children.map((c) => c.href)).toEqual([
      `/g/${B_ID}/directory`,
      `/g/${B_ID}/directory/families`,
      `/g/${B_ID}/directory/birthdays`,
      `/g/${B_ID}/directory/anniversaries`,
    ]);
  });
});

describe("buildSidebar — rail and phone flags", () => {
  it("passes collapsed through and shows the collapse control off the phone only", () => {
    const rail = buildSidebar(input({ memberships: [A], activeGroup: A, collapsed: true }));
    expect(rail.collapsed).toBe(true);
    expect(rail.showCollapseControl).toBe(true);
    expect(outline(rail.items)).toEqual(
      outline(buildSidebar(input({ memberships: [A], activeGroup: A })).items)
    );

    const phone = buildSidebar(input({ memberships: [A], activeGroup: A, phone: true }));
    expect(phone.showCollapseControl).toBe(false);
    expect(phone.collapsed).toBe(false);
  });
});
