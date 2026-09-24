import type { ComponentType } from "react";
import {
  Users,
  Home,
  MailPlus,
  CalendarDays,
  Calendar,
  BarChart2,
  HandCoins,
  Info,
  BookOpen,
  Megaphone,
  Settings,
} from "lucide-react";

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
      { href: "/admin/groups", label: "Groups", icon: Users },
      { href: "/admin/invite", label: "Bulk Invite", icon: MailPlus },
    ],
  },
  {
    key: "events",
    label: "Events",
    items: [
      { href: "/admin/calendars", label: "Event Calendars", icon: CalendarDays },
      { href: "/admin/events/new", label: "Create Event", icon: Calendar },
      { href: "/admin/serving", label: "Serving Stats", icon: BarChart2 },
    ],
  },
  {
    key: "content",
    label: "Content",
    items: [
      { href: "/admin/lectures", label: "Lectures & Series", icon: BookOpen },
      { href: "/admin/about", label: "About Page", icon: Info, contentEditorVisible: true },
      { href: "/admin/announcements/new", label: "New Announcement", icon: Megaphone },
    ],
  },
  {
    key: "giving",
    label: "Giving",
    items: [{ href: "/admin/giving", label: "Giving", icon: HandCoins }],
  },
  {
    key: "settings",
    label: "Settings",
    items: [{ href: "/admin/settings", label: "Settings", icon: Settings }],
  },
];
