import type { ComponentType } from "react";
import { Users, Home, MailPlus, Settings } from "lucide-react";

export interface AdminNavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Visible to content_editor as well as admin. Defaults to admin-only. */
  contentEditorVisible?: boolean;
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
      { href: "/admin/groups", label: "Teams", icon: Users },
      { href: "/admin/invite", label: "Bulk invite", icon: MailPlus },
    ],
  },
  {
    key: "settings",
    label: "Settings",
    items: [{ href: "/admin/settings", label: "Org settings", icon: Settings }],
  },
];
