"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronsUpDown, LayoutGrid } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SidebarItem } from "@/lib/groups/nav";

type GroupBlock = Extract<SidebarItem, { kind: "groupBlock" }>;

const ALL_GROUPS = "All groups";

function InitialsCircle({ block }: { block: GroupBlock }) {
  if (!block.group) {
    return (
      <span
        aria-hidden="true"
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-border text-foreground"
      >
        <LayoutGrid className="h-5 w-5" />
      </span>
    );
  }
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

function ColorDot({ color }: { color: string }) {
  return <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />;
}

function BlockText({ block }: { block: GroupBlock }) {
  return (
    <span className="min-w-0 flex-1 text-left">
      <span className="block truncate text-sm text-muted-foreground">{block.orgName}</span>
      <span className="block truncate font-serif text-xl font-semibold leading-tight text-foreground">
        {block.group?.name ?? ALL_GROUPS}
      </span>
    </span>
  );
}

/**
 * The group block above the pages: a static label for a one-group member, a
 * menu for a member of two or more, whose first row is the page listing all
 * of their groups. The group is always named in text beside its color; the
 * collapsed sidebar shows the initials circle.
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

  const name = block.group?.name ?? ALL_GROUPS;

  if (block.mode === "static") {
    return collapsed ? (
      <div className="flex justify-center py-2" title={block.group.name}>
        <InitialsCircle block={block} />
        <span className="sr-only">{block.group.name}</span>
      </div>
    ) : (
      <div className="flex items-center gap-3 rounded-lg px-3 py-2">
        <ColorDot color={block.group.color} />
        <BlockText block={block} />
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-haspopup="menu"
        aria-label={block.group ? `Switch group. Current group: ${name}` : "Switch group. Showing all groups"}
        title={collapsed ? name : undefined}
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
            <span className="absolute -bottom-0.5 -right-0.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-foreground">
              <ChevronsUpDown className="h-3 w-3" aria-hidden="true" />
            </span>
          </>
        ) : (
          <>
            {block.group && <ColorDot color={block.group.color} />}
            <BlockText block={block} />
            <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={collapsed ? "right" : "bottom"}
        align="start"
        sideOffset={collapsed ? 12 : 4}
        className="w-64 max-h-80 overflow-y-auto rounded-xl p-1.5"
      >
        <DropdownMenuItem
          className="rounded-lg px-2.5"
          aria-current={block.group ? undefined : "true"}
          render={<Link href={block.allGroupsHref} onClick={onNavigate} />}
        >
          {ALL_GROUPS}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {block.rows.map((row) => (
          <DropdownMenuItem
            key={row.group.id}
            className="min-h-11 gap-3 rounded-lg px-2.5 text-base"
            aria-current={row.current ? "true" : undefined}
            render={<Link href={row.href(pathname)} onClick={onNavigate} />}
          >
            <ColorDot color={row.group.color} />
            <span className="min-w-0 flex-1 truncate" title={row.group.name}>
              {row.group.name}
            </span>
            {row.group.role === "leader" && (
              <Badge variant="role" className="ml-auto">
                Leader
              </Badge>
            )}
          </DropdownMenuItem>
        ))}
        {block.findAGroupFooter && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="min-h-11 rounded-lg px-2.5 text-base font-semibold text-brand-primary-text"
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
