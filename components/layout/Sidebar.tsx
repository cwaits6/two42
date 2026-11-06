"use client";

import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { Account } from "./account";
import { AccountBlock } from "./AccountBlock";
import { FrameNav } from "./FrameNav";
import { useSidebar } from "./SidebarContext";
import { Wordmark } from "./Wordmark";

/** The frame at desktop widths: the wordmark, the page list, then the account. */
export function Sidebar({ account }: { account: Account }) {
  const { collapsed, setCollapsed } = useSidebar();
  const CollapseIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const collapseLabel = collapsed ? "Expand menu" : "Collapse menu";

  return (
    <aside
      className={`sticky top-0 hidden h-dvh shrink-0 flex-col self-start border-r border-border bg-card transition-all duration-200 md:flex ${
        collapsed ? "w-[72px]" : "w-60"
      }`}
    >
      <div
        className={`flex items-center gap-1 pt-3 pb-2 ${
          collapsed ? "flex-col px-2" : "justify-between pl-5 pr-2"
        }`}
      >
        <Wordmark href="/dashboard" mark={collapsed} />
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapseLabel}
          aria-expanded={!collapsed}
          title={collapseLabel}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-brand-warm/50 hover:text-brand-primary-text"
        >
          <CollapseIcon className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        <FrameNav account={account} collapsed={collapsed} />
      </div>
      <div className="border-t border-border p-2">
        <AccountBlock account={account} collapsed={collapsed} />
      </div>
    </aside>
  );
}
