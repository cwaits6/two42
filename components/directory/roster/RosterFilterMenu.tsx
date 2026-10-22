"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  EMPTY_FILTER,
  filterButtonLabel,
  isEmptyFilter,
  toggleInSet,
  type RosterFilter,
} from "@/components/directory/rosterFilter";
import type { RosterLabel, RosterTeam } from "@/components/directory/useGroupRoster";

interface RosterFilterMenuProps {
  teams: RosterTeam[];
  labels: RosterLabel[];
  filter: RosterFilter;
  onChange: (filter: RosterFilter) => void;
}

const ITEM_CLASS = "min-h-11 text-base";

function Dot({ color }: { color: string | null }) {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color ?? "var(--color-brand-neutral)" }}
      aria-hidden="true"
    />
  );
}

/**
 * One button that opens a checkbox menu under two headings. Nothing renders
 * when the group has neither teams nor labels, so the roster of a new group
 * shows no empty control.
 */
export function RosterFilterMenu({ teams, labels, filter, onChange }: RosterFilterMenuProps) {
  if (teams.length + labels.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" aria-haspopup="menu" />}
      >
        {filterButtonLabel(filter)}
        <ChevronDown aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-64">
        {teams.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-sm">Teams</DropdownMenuLabel>
            {teams.map((team) => (
              <DropdownMenuCheckboxItem
                key={team.id}
                className={ITEM_CLASS}
                closeOnClick={false}
                checked={filter.teamIds.has(team.id)}
                onCheckedChange={() =>
                  onChange({ ...filter, teamIds: toggleInSet(filter.teamIds, team.id) })
                }
              >
                <Dot color={team.color} />
                {team.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
        )}
        {labels.length > 0 && (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-sm">Labels</DropdownMenuLabel>
            {labels.map((label) => (
              <DropdownMenuCheckboxItem
                key={label.id}
                className={ITEM_CLASS}
                closeOnClick={false}
                checked={filter.labelIds.has(label.id)}
                onCheckedChange={() =>
                  onChange({ ...filter, labelIds: toggleInSet(filter.labelIds, label.id) })
                }
              >
                <Dot color={label.color} />
                {label.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuGroup>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className={ITEM_CLASS}
          disabled={isEmptyFilter(filter)}
          onClick={() => onChange(EMPTY_FILTER)}
        >
          Clear filters
        </DropdownMenuItem>
        <p className="px-1.5 pt-1 pb-1.5 text-sm text-muted-foreground">
          Leaders set teams and labels in Group settings.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
