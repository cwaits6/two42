import type { ComponentType } from "react";
import { Users, Home, MailPlus, Settings, UsersRound } from "lucide-react";

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
      { href: "/admin/invite", label: "Import members", icon: MailPlus },
      { href: "/admin/groups", label: "Groups", icon: UsersRound },
      { href: "/admin/settings", label: "Church settings", icon: Settings },
    ],
  },
];
