"use client";

import type { Profile } from "@/lib/types";
import { SidebarNav } from "./SidebarNav";
import { useSidebar } from "./SidebarContext";
import { useSidebarModel } from "./useSidebarModel";

interface SidebarProps {
  profile: Profile;
  hasServingAccess: boolean;
  orgName: string;
}

export function Sidebar({ profile, hasServingAccess, orgName }: SidebarProps) {
  const { collapsed } = useSidebar();
  const model = useSidebarModel({ profile, hasServingAccess, orgName, collapsed, phone: false });

  return (
    <aside
      className={`hidden md:flex flex-col border-r border-border bg-white shrink-0 transition-all duration-200 ${
        collapsed ? "w-[72px]" : "w-60"
      }`}
    >
      <nav
        aria-label="Main navigation"
        className="flex flex-1 flex-col overflow-hidden py-4 px-2"
      >
        <SidebarNav model={model} />
      </nav>
    </aside>
  );
}
