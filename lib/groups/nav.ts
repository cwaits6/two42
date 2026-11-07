// The page list as data. The desktop sidebar and the phone drawer render the
// list built here, so a state cannot drift between them, and every state the
// list can be in is a row in nav.test.ts.

import {
  GROUP_PREFIX,
  groupInitials,
  swapGroupInPath,
  type ActiveGroup,
} from "@/lib/groups/active";

export type IconName =
  | "home"
  | "calendar"
  | "directory"
  | "announcements"
  | "lectures"
  | "about"
  | "serving"
  | "prayer"
  | "give"
  | "group-settings"
  | "find-a-group";

export type SidebarLink = {
  kind: "link";
  href: string;
  label: string;
  icon: IconName;
  exact?: boolean;
  /** Set apart from the pages: smaller and muted. */
  quiet?: true;
  /** Waiting on the viewer; never zero. */
  count?: number;
};

export type SwitcherRow = {
  group: ActiveGroup;
  current: boolean;
  href: (pathname: string) => string;
};

export type SidebarItem =
  | SidebarLink
  | ({
      kind: "groupBlock";
      orgName: string;
      initials: string;
      /** The page listing all of the person's groups: the switcher's first row. */
      allGroupsHref: "/dashboard";
      rows: SwitcherRow[];
      findAGroupFooter: boolean;
    } & (
      | { mode: "static"; group: ActiveGroup }
      /** Null at the church level, where the switcher reads "All groups". */
      | { mode: "switcher"; group: ActiveGroup | null }
    ))
  /** Spacing between clusters of pages. */
  | { kind: "gap" }
  /** A rule. */
  | { kind: "separator" };

export type SidebarInput = {
  memberships: ActiveGroup[];
  /** Inside-a-group semantics (useActiveGroup): null at the church level. */
  activeGroup: ActiveGroup | null;
  discoveryOn: boolean;
  /** The viewer leads the active group. */
  isLeader: boolean;
  /** Requests to join waiting on the active group, for its leader; null at zero or when not counted. */
  waitingRequests?: number | null;
  hasServingAccess: boolean;
  orgName: string;
};

const GAP: SidebarItem = { kind: "gap" };

const HOME: SidebarLink = { kind: "link", href: "/dashboard", label: "Home", icon: "home", exact: true };
const FIND_A_GROUP: SidebarLink = {
  kind: "link",
  href: "/find-a-group",
  label: "Find a group",
  icon: "find-a-group",
  quiet: true,
};

/**
 * A group's pages in their three clusters. `churchBase` is where Home,
 * Calendar and Directory live: the group's own prefix for a member of two or
 * more groups, and the unprefixed addresses for a member of one.
 */
function groupPages(group: ActiveGroup, churchBase: string, input: SidebarInput): SidebarItem[] {
  const groupBase = `${GROUP_PREFIX}/${group.id}`;
  const link = (base: string, path: string, label: string, icon: IconName): SidebarLink => ({
    kind: "link",
    href: `${base}${path}`,
    label,
    icon,
  });
  const home: SidebarLink = churchBase ? link(churchBase, "/dashboard", "Home", "home") : HOME;
  const items: SidebarItem[] = [
    home,
    link(churchBase, "/calendar", "Calendar", "calendar"),
    link(groupBase, "/announcements", "Announcements", "announcements"),
    GAP,
    link(groupBase, "/prayer", "Prayer", "prayer"),
    link(groupBase, "/lectures", "Lessons", "lectures"),
  ];
  if (input.hasServingAccess) items.push(link(groupBase, "/serving", "Serving", "serving"));
  items.push(
    GAP,
    // One entry: the directory page's own tabs are its navigation.
    link(churchBase, "/directory", "Directory", "directory"),
    link(groupBase, "/give", "Give", "give"),
    link(groupBase, "/about", "About", "about")
  );
  if (input.isLeader) {
    const settings = link(groupBase, "/settings", "Group settings", "group-settings");
    if (input.waitingRequests) settings.count = input.waitingRequests;
    items.push({ kind: "separator" }, settings);
  }
  return items;
}

function staticBlock(group: ActiveGroup, input: SidebarInput): SidebarItem {
  return {
    kind: "groupBlock",
    mode: "static",
    group,
    orgName: input.orgName,
    initials: groupInitials(group.name),
    allGroupsHref: "/dashboard",
    rows: [],
    findAGroupFooter: false,
  };
}

function switcherBlock(group: ActiveGroup | null, input: SidebarInput): SidebarItem {
  return {
    kind: "groupBlock",
    mode: "switcher",
    group,
    orgName: input.orgName,
    initials: group ? groupInitials(group.name) : "",
    allGroupsHref: "/dashboard",
    rows: input.memberships.map((m) => ({
      group: m,
      current: m.id === group?.id,
      href: (pathname: string) => swapGroupInPath(pathname, m),
    })),
    findAGroupFooter: input.discoveryOn,
  };
}

export function buildSidebar(input: SidebarInput): SidebarItem[] {
  const { memberships, activeGroup, discoveryOn } = input;

  if (memberships.length === 0) {
    return discoveryOn ? [HOME, GAP, FIND_A_GROUP] : [HOME];
  }

  if (memberships.length === 1) {
    const group = memberships[0];
    const items = [staticBlock(group, input), ...groupPages(group, "", input)];
    // A static block has no menu to hold it.
    if (discoveryOn) items.push(GAP, FIND_A_GROUP);
    return items;
  }

  if (!activeGroup) {
    return [
      switcherBlock(null, input),
      HOME,
      { kind: "link", href: "/calendar", label: "Calendar", icon: "calendar" },
      GAP,
      { kind: "link", href: "/directory", label: "Directory", icon: "directory" },
    ];
  }

  return [
    switcherBlock(activeGroup, input),
    ...groupPages(activeGroup, `${GROUP_PREFIX}/${activeGroup.id}`, input),
  ];
}
