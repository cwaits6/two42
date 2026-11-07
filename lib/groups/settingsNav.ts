import type { ComponentType } from "react";
import { FileText, Inbox, Link2, Lock, Tag, UsersRound } from "lucide-react";
import { groupPath } from "@/lib/groups/active";

export interface GroupSettingsNavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

export const GROUP_REQUESTS_SECTION = "/settings/requests";

/** Group settings' sections, in their order. Paths are under the group's prefix. */
export const GROUP_SETTINGS_SECTIONS: GroupSettingsNavItem[] = [
  { href: "/settings/details", label: "Details", icon: FileText },
  { href: GROUP_REQUESTS_SECTION, label: "Requests", icon: Inbox },
  { href: "/settings/privacy", label: "Privacy and joining", icon: Lock },
  { href: "/settings/invites", label: "Invite links", icon: Link2 },
  { href: "/settings/teams", label: "Teams", icon: UsersRound },
  { href: "/settings/labels", label: "Labels", icon: Tag },
];

export function groupSettingsNavItems(groupId: string): GroupSettingsNavItem[] {
  return GROUP_SETTINGS_SECTIONS.map((item) => ({ ...item, href: groupPath(groupId, item.href) }));
}
