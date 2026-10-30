import type { ComponentType } from "react";
import { Users, Home, MailPlus, Settings, UsersRound } from "lucide-react";

export interface AdminNavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export interface AdminNavGroup {
  key: string;
  label: string;
  items: AdminNavItem[];
}

/**
 * Single source of truth for admin destinations, labels, and grouping —
 * shared by the admin area's sub-nav and any other admin nav surface.
 */
export const adminNavGroups: AdminNavGroup[] = [
  {
    key: "people",
    label: "People",
    items: [
      { href: "/admin/members", label: "Members", icon: Users },
      { href: "/admin/families", label: "Families", icon: Home },
      { href: "/admin/invite", label: "Import members", icon: MailPlus },
    ],
  },
  {
    key: "groups",
    label: "Groups",
    items: [{ href: "/admin/groups", label: "Groups", icon: UsersRound }],
  },
  {
    key: "settings",
    label: "Settings",
    items: [{ href: "/admin/settings", label: "Org settings", icon: Settings }],
  },
];
