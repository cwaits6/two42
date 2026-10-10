// The sidebar as data. Every frame surface (desktop pane, collapsed rail,
// phone drawer) renders the model built here, so a state cannot drift
// between them, and every state the frame can be in is a row in nav.test.ts.

import {
  GROUP_PREFIX,
  groupInitials,
  groupPath,
  swapGroupInPath,
  type ActiveGroup,
} from "@/lib/groups/active";

export type IconName =
  | "home"
  | "dashboard"
  | "calendar"
  | "directory"
  | "announcements"
  | "lectures"
  | "about"
  | "serving"
  | "prayer"
  | "give"
  | "group-settings"
  | "find-a-group"
  | "profile"
  | "settings"
  | "admin";

export type SidebarLink = {
  kind: "link";
  href: string;
  label: string;
  icon: IconName;
  exact?: boolean;
};

export type SwitcherRow = {
  group: ActiveGroup;
  current: boolean;
  href: (pathname: string) => string;
};

export type SidebarItem =
  | SidebarLink
  | { kind: "directory"; href: string; children: { href: string; label: string }[] }
  | {
      kind: "groupBlock";
      mode: "static" | "switcher";
      group: ActiveGroup;
      orgName: string;
      initials: string;
      rows: SwitcherRow[];
      findAGroupFooter: boolean;
    }
  | { kind: "yourGroups"; rows: { group: ActiveGroup; href: string }[] }
  | { kind: "separator" };

export type SidebarInput = {
  memberships: ActiveGroup[];
  /** Inside-a-group semantics (useActiveGroup): null at the org level. */
  activeGroup: ActiveGroup | null;
  discoveryOn: boolean;
  /** The viewer leads the active group. */
  isLeader: boolean;
  isOrgAdmin: boolean;
  isContentEditor: boolean;
  hasServingAccess: boolean;
  collapsed: boolean;
  phone: boolean;
  orgName: string;
};

export type SidebarModel = {
  items: SidebarItem[];
  showCollapseControl: boolean;
  phonePill: { group: ActiveGroup } | null;
  collapsed: boolean;
};

const HOME: SidebarLink = { kind: "link", href: "/dashboard", label: "Home", icon: "home", exact: true };
const FIND_A_GROUP: SidebarLink = {
  kind: "link",
  href: "/find-a-group",
  label: "Find a group",
  icon: "find-a-group",
};

function directoryItem(base: string, discoveryOn: boolean): SidebarItem {
  const children = [
    { href: `${base}/directory`, label: "Members" },
    { href: `${base}/directory/families`, label: "Families" },
    { href: `${base}/directory/birthdays`, label: "Birthdays" },
    { href: `${base}/directory/anniversaries`, label: "Anniversaries" },
  ];
  if (discoveryOn) children.push({ href: `${base}/directory/groups`, label: "Groups" });
  return { kind: "directory", href: `${base}/directory`, children };
}

function groupPages(group: ActiveGroup, input: SidebarInput): SidebarItem[] {
  const link = (path: string, label: string, icon: IconName): SidebarLink => ({
    kind: "link",
    href: groupPath(group.id, path),
    label,
    icon,
  });
  const items: SidebarItem[] = [
    link("/announcements", "Announcements", "announcements"),
    link("/lectures", "Lectures", "lectures"),
    link("/about", "About", "about"),
  ];
  if (input.hasServingAccess) items.push(link("/serving", "Serving", "serving"));
  items.push(link("/prayer", "Prayer", "prayer"), link("/give", "Give", "give"));
  if (input.isLeader) items.push(link("/settings", "Group settings", "group-settings"));
  return items;
}

function groupBlock(
  mode: "static" | "switcher",
  group: ActiveGroup,
  input: SidebarInput
): SidebarItem {
  const rows: SwitcherRow[] =
    mode === "switcher"
      ? input.memberships.map((m) => ({
          group: m,
          current: m.id === group.id,
          href: (pathname: string) => swapGroupInPath(pathname, m),
        }))
      : [];
  return {
    kind: "groupBlock",
    mode,
    group,
    orgName: input.orgName,
    initials: groupInitials(group.name),
    rows,
    findAGroupFooter: mode === "switcher" && input.discoveryOn,
  };
}

export function buildSidebar(input: SidebarInput): SidebarModel {
  const { memberships, activeGroup, discoveryOn } = input;
  const items: SidebarItem[] = [HOME];

  if (memberships.length === 0) {
    if (discoveryOn) items.push(FIND_A_GROUP);
  } else if (memberships.length === 1) {
    const group = memberships[0];
    if (discoveryOn) items.push(groupBlock("static", group, input), FIND_A_GROUP);
    items.push(
      { kind: "link", href: "/calendar", label: "Calendar", icon: "calendar" },
      directoryItem("", discoveryOn),
      ...groupPages(group, input)
    );
  } else if (!activeGroup) {
    items.push(
      { kind: "link", href: "/calendar", label: "Calendar", icon: "calendar" },
      directoryItem("", discoveryOn),
      {
        kind: "yourGroups",
        rows: memberships.map((group) => ({ group, href: groupPath(group.id, "/dashboard") })),
      }
    );
    if (discoveryOn) items.push(FIND_A_GROUP);
  } else {
    const base = `${GROUP_PREFIX}/${activeGroup.id}`;
    items.push(
      groupBlock("switcher", activeGroup, input),
      { kind: "link", href: `${base}/dashboard`, label: "Dashboard", icon: "dashboard" },
      { kind: "link", href: `${base}/calendar`, label: "Calendar", icon: "calendar" },
      directoryItem(base, discoveryOn),
      ...groupPages(activeGroup, input)
    );
  }

  items.push(
    { kind: "separator" },
    { kind: "link", href: "/profile", label: "My Profile", icon: "profile" },
    { kind: "link", href: "/settings", label: "Settings", icon: "settings" }
  );

  if (input.isOrgAdmin || input.isContentEditor) {
    items.push(
      { kind: "separator" },
      { kind: "link", href: "/admin", label: "Admin", icon: "admin" }
    );
  }

  const insideWithSwitcher = activeGroup !== null && memberships.length >= 2;
  return {
    items,
    showCollapseControl: !input.phone,
    phonePill: input.phone && insideWithSwitcher && activeGroup ? { group: activeGroup } : null,
    collapsed: input.collapsed,
  };
}
