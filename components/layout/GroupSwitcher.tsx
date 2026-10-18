"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SidebarItem } from "@/lib/groups/nav";

type GroupBlock = Extract<SidebarItem, { kind: "groupBlock" }>;

function InitialsCircle({ block }: { block: GroupBlock }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-serif text-lg font-semibold text-white"
      style={{ background: block.group.color }}
    >
      {block.initials}
    </span>
  );
}

function BlockText({ block }: { block: GroupBlock }) {
  return (
    <span className="min-w-0 flex-1 text-left">
      <span className="block truncate text-sm text-muted-foreground">{block.orgName}</span>
      <span className="block truncate font-serif text-xl font-semibold leading-tight text-foreground">
        {block.group.name}
      </span>
    </span>
  );
}

function LeaderBadge() {
  return (
    <span className="ml-auto shrink-0 rounded border border-brand-accent/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-brand-accent-text">
      Leader
    </span>
  );
}

/**
 * The group block at the top of the frame: a static label for a one-group
 * member, a menu for a member of two or more. The group is always named in
 * text beside its color; the collapsed rail shows the initials circle.
 */
export function GroupSwitcher({
  block,
  collapsed,
  onNavigate,
}: {
  block: GroupBlock;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  if (block.mode === "static") {
    return collapsed ? (
      <div className="flex justify-center py-2" title={block.group.name}>
        <InitialsCircle block={block} />
        <span className="sr-only">{block.group.name}</span>
      </div>
    ) : (
      <div className="flex items-center gap-3 rounded-lg px-3 py-2">
        <span
          aria-hidden="true"
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ background: block.group.color }}
        />
        <BlockText block={block} />
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-haspopup="menu"
        aria-label={`Switch group. Current group: ${block.group.name}`}
        title={collapsed ? block.group.name : undefined}
        render={
          <button
            type="button"
            className={
              collapsed
                ? "relative mx-auto flex h-12 w-12 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
                : "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-brand-warm/50 focus-visible:bg-brand-warm/50 focus-visible:outline-none"
            }
          />
        }
      >
        {collapsed ? (
          <>
            <InitialsCircle block={block} />
            <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-white text-foreground">
              <ChevronsUpDown className="h-3 w-3" aria-hidden="true" />
            </span>
          </>
        ) : (
          <>
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ background: block.group.color }}
            />
            <BlockText block={block} />
            <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={collapsed ? "right" : "bottom"}
        align="start"
        sideOffset={collapsed ? 12 : 4}
        className="w-64 max-h-60 overflow-y-auto rounded-xl p-1.5"
      >
        {block.rows.map((row) => (
          <DropdownMenuItem
            key={row.group.id}
            className="min-h-11 gap-3 rounded-lg px-2.5 text-base"
            aria-current={row.current ? "true" : undefined}
            render={<Link href={row.href(pathname)} onClick={onNavigate} />}
          >
            <span
              aria-hidden="true"
              className="h-3 w-3 shrink-0 rounded-full"
              style={{ background: row.group.color }}
            />
            <span className="min-w-0 flex-1 truncate" title={row.group.name}>
              {row.group.name}
            </span>
            {row.group.role === "leader" && <LeaderBadge />}
          </DropdownMenuItem>
        ))}
        {block.findAGroupFooter && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="min-h-11 rounded-lg px-2.5 text-base font-semibold text-brand-primary"
              render={<Link href="/find-a-group" onClick={onNavigate} />}
            >
              Find a group
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
