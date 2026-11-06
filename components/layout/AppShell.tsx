"use client";

import { Sidebar } from "./Sidebar";
import { useSidebar } from "./SidebarContext";

// The header is about 4.25rem tall; filling the rest keeps a short page from
// floating the footer up the screen. Signed in, the header exists only below
// md, where the sidebar takes its place.
const UNDER_HEADER = "min-h-[calc(100dvh-4.25rem)]";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { account } = useSidebar();

  if (!account) {
    return <main className={`${UNDER_HEADER} flex-1`}>{children}</main>;
  }

  return (
    <div className="flex flex-1">
      <Sidebar account={account} />
      <main className={`${UNDER_HEADER} min-w-0 flex-1 overflow-y-auto md:min-h-dvh`}>{children}</main>
    </div>
  );
}
