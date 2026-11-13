import type { ComponentType } from "react";
import { ChartColumn, Users, Home, Inbox, Settings, UsersRound } from "lucide-react";

export interface AdminNavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export interface AdminNavGroup {
  key: string;
  /** Left out for a section that needs no heading. */
  label?: string;
  items: AdminNavItem[];
}

/**
 * Single source of truth for admin destinations and labels, shared by the
 * admin area's sub-nav and any other admin nav surface.
 */
export const adminNavGroups: AdminNavGroup[] = [
  {
    key: "destinations",
    items: [
      { href: "/admin/members", label: "Members", icon: Users },
      { href: "/admin/families", label: "Households", icon: Home },
      { href: "/admin/groups", label: "Groups", icon: UsersRound },
      { href: "/admin/requests", label: "Requests", icon: Inbox },
      { href: "/admin/usage", label: "Usage", icon: ChartColumn },
      { href: "/admin/settings", label: "Church settings", icon: Settings },
    ],
  },
];
