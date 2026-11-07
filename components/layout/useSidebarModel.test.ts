import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { GroupProvider } from "@/components/groups/GroupProvider";
import type { ActiveGroup } from "@/lib/groups/active";
import type { SidebarItem } from "@/lib/groups/nav";
import { SidebarProvider } from "./SidebarContext";
import { useSidebarModel } from "./useSidebarModel";

let pathname = "/";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const B: ActiveGroup = { id: "c0000000-0000-0000-0000-00000000000b", name: "Group B", color: "#111111", role: "leader" };
const C: ActiveGroup = { id: "c0000000-0000-0000-0000-00000000000c", name: "Group C", color: "#222222", role: "member" };
const D: ActiveGroup = { id: "c0000000-0000-0000-0000-00000000000d", name: "Group D", color: "#333333", role: "leader" };

/** The page list the hook builds from the real providers, for a viewer on `path`. */
function model(
  path: string,
  viewer: {
    memberships: ActiveGroup[];
    hasServingAccess?: boolean;
    discoveryOn?: boolean;
    groupWaitingRequests?: Record<string, number>;
  },
) {
  pathname = path;
  let items: SidebarItem[] = [];
  const Probe = () => {
    items = useSidebarModel();
    return null;
  };
  const frame = {
    account: null,
    hasServingAccess: viewer.hasServingAccess ?? false,
    orgName: "Sample Organization",
    groupWaitingRequests: viewer.groupWaitingRequests,
    children: createElement(Probe),
  };
  const groups = {
    memberships: viewer.memberships,
    discoveryOn: viewer.discoveryOn ?? false,
    creation: { policy: "approval" as const, isOrgAdmin: false },
    children: createElement(SidebarProvider, frame),
  };
  renderToStaticMarkup(createElement(GroupProvider, groups));
  const block = items.find((i) => i.kind === "groupBlock");
  const settings = items.find((i) => i.kind === "link" && i.label === "Group settings");
  return {
    settingsCount: settings?.kind === "link" ? settings.count : undefined,
    labels: items.flatMap((i) => (i.kind === "link" ? [i.label] : [])),
    findAGroupInSwitcher: block?.kind === "groupBlock" && block.findAGroupFooter,
  };
}

describe("useSidebarModel", () => {
  it("offers Group settings only inside a group the viewer leads", () => {
    const both = { memberships: [B, C] };
    expect(model(`/g/${B.id}/dashboard`, both).labels).toContain("Group settings");
    expect(model(`/g/${C.id}/dashboard`, both).labels).not.toContain("Group settings");
    expect(model("/dashboard", both).labels).not.toContain("Group settings");
    expect(model("/dashboard", { memberships: [B] }).labels).toContain("Group settings");
    expect(model("/dashboard", { memberships: [C] }).labels).not.toContain("Group settings");
  });

  it("counts the waiting requests of the group the viewer is in, never another group's", () => {
    const counts = { [B.id]: 2, [C.id]: 7, [D.id]: 5 };
    const viewer = { memberships: [B, C, D], groupWaitingRequests: counts };
    expect(model(`/g/${B.id}/dashboard`, viewer).settingsCount).toBe(2);
    expect(model(`/g/${D.id}/dashboard`, viewer).settingsCount).toBe(5);
    const asMember = model(`/g/${C.id}/dashboard`, viewer);
    expect(asMember.labels).not.toContain("Group settings");
    expect(asMember.settingsCount).toBeUndefined();
    expect(model(`/g/${B.id}/dashboard`, { memberships: [B, D], groupWaitingRequests: { [D.id]: 5 } }).settingsCount).toBeUndefined();
  });

  it("offers Serving only to someone with Serving", () => {
    expect(model("/dashboard", { memberships: [C], hasServingAccess: true }).labels).toContain("Serving");
    expect(model("/dashboard", { memberships: [C] }).labels).not.toContain("Serving");
  });

  it("offers Find a group only while the church lets members find groups", () => {
    const path = `/g/${C.id}/dashboard`;
    expect(model(path, { memberships: [B, C], discoveryOn: true }).findAGroupInSwitcher).toBe(true);
    expect(model(path, { memberships: [B, C] }).findAGroupInSwitcher).toBe(false);
    expect(model("/dashboard", { memberships: [C], discoveryOn: true }).labels).toContain("Find a group");
    expect(model("/dashboard", { memberships: [C] }).labels).not.toContain("Find a group");
  });
});
