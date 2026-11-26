import type { ComponentType } from "react";
import { FileText, Inbox, KeyRound, Link2, Lock, Tag, UsersRound } from "lucide-react";
import { can, type GroupAbility } from "@/lib/groups/abilities";
import { groupPath, type ActiveGroup } from "@/lib/groups/active";

export interface GroupSettingsNavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

interface GroupSettingsSection extends GroupSettingsNavItem {
  /** Who reaches the page: holders of an ability, or leaders only. */
  needs: GroupAbility | "leader";
}

export const GROUP_REQUESTS_SECTION = "/settings/requests";

/** Group settings' sections, in their order. Paths are under the group's prefix. */
export const GROUP_SETTINGS_SECTIONS: GroupSettingsSection[] = [
  { href: "/settings/details", label: "Details", icon: FileText, needs: "leader" },
  { href: GROUP_REQUESTS_SECTION, label: "Requests", icon: Inbox, needs: "members" },
  { href: "/settings/privacy", label: "Privacy and joining", icon: Lock, needs: "leader" },
  { href: "/settings/invites", label: "Invite links", icon: Link2, needs: "members" },
  { href: "/settings/abilities", label: "Abilities", icon: KeyRound, needs: "leader" },
  { href: "/settings/teams", label: "Teams", icon: UsersRound, needs: "teams" },
  { href: "/settings/labels", label: "Labels", icon: Tag, needs: "members" },
];

type Viewer = Pick<ActiveGroup, "role" | "abilities">;

function reaches(group: Viewer, needs: GroupSettingsSection["needs"]): boolean {
  return needs === "leader" ? group.role === "leader" : can(group, needs);
}

/** The sections this viewer reaches, in order, under the group's prefix. */
export function groupSettingsNavItems(group: Viewer & { id: string }): GroupSettingsNavItem[] {
  return GROUP_SETTINGS_SECTIONS.filter((item) => reaches(group, item.needs)).map(({ href, label, icon }) => ({
    href: groupPath(group.id, href),
    label,
    icon,
  }));
}

/** Where Group settings opens for this viewer, or null when they reach none of it. */
export function firstGroupSettingsSection(group: Viewer & { id: string }): string | null {
  return groupSettingsNavItems(group)[0]?.href ?? null;
}
