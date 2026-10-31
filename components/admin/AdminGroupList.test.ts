import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AdminGroupRow } from "./adminGroups";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("@/components/admin/GroupLeadersDialog", () => ({ GroupLeadersDialog: () => null }));

const { AdminGroupList } = await import("./AdminGroupList");

function group(overrides: Partial<AdminGroupRow>): AdminGroupRow {
  return { id: "g", name: "Tuesday Group", description: null, memberCount: 3, leaderNames: [], ...overrides };
}

const render = (groups: AdminGroupRow[]) => renderToStaticMarkup(createElement(AdminGroupList, { groups }));

describe("AdminGroupList", () => {
  it("marks a group with no leader", () => {
    const html = render([group({ leaderNames: [] })]);
    expect(html).toContain("No leader");
    expect(html).not.toContain("Leader: ");
    expect(html).toContain('aria-label="Manage leaders of Tuesday Group"');
  });

  it("names the leaders of a group that has them", () => {
    expect(render([group({ leaderNames: ["Ada Lovelace"] })])).toContain("Leader: </span>Ada Lovelace");
    const html = render([group({ leaderNames: ["Ada Lovelace", "Cy Park"] })]);
    expect(html).toContain("Leaders: </span>Ada Lovelace, Cy Park");
    expect(html).not.toContain("No leader");
  });

  it("says when the church has no groups", () => {
    expect(render([])).toContain("No groups yet.");
  });
});
