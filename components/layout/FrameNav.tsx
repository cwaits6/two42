"use client";

import { usePathname } from "next/navigation";
import { useActiveGroup } from "@/components/groups/GroupProvider";
import type { Account } from "./account";
import { AreaNav, areaFor } from "./AreaNav";
import { SidebarNav } from "./SidebarNav";
import { useSidebarModel } from "./useSidebarModel";

/**
 * The page list for where the person is: church admin pages, Platform pages,
 * a group's Group settings, or a member's own. An area's list shows only to
 * someone that area is for, so a path under it that does not resolve never
 * offers its pages.
 */
export function FrameNav({
  account,
  collapsed = false,
  onNavigate,
}: {
  account: Account;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const area = areaFor(usePathname());
  const group = useActiveGroup();
  if (area === "admin" && account.isChurchAdmin) {
    return <AreaNav area="admin" collapsed={collapsed} onNavigate={onNavigate} />;
  }
  if (area === "platform" && account.isOperator) {
    return <AreaNav area="platform" collapsed={collapsed} onNavigate={onNavigate} />;
  }
  if (!account.isMember) return null;
  if (area === "groupSettings" && group?.role === "leader") {
    return <AreaNav area="groupSettings" group={group} collapsed={collapsed} onNavigate={onNavigate} />;
  }
  return <MemberNav collapsed={collapsed} onNavigate={onNavigate} />;
}

function MemberNav({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const items = useSidebarModel();
  return (
    <nav aria-label="Main navigation" className="flex flex-col space-y-1">
      <SidebarNav items={items} collapsed={collapsed} onNavigate={onNavigate} />
    </nav>
  );
}
