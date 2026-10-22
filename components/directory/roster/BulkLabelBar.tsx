"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { RosterLabel } from "@/components/directory/useGroupRoster";

interface BulkLabelBarProps {
  selectedCount: number;
  labels: RosterLabel[];
  stateFor: (labelId: string) => "all" | "some" | "none";
  onApply: (labelId: string) => void;
  onRemove: (labelId: string) => void;
  onDone: () => void;
}

/**
 * The bar under the list in Select mode. A label checked for everyone
 * selected is removed on toggle; one that only some of them carry says so
 * in words and is applied to all of them on toggle.
 */
export function BulkLabelBar({
  selectedCount,
  labels,
  stateFor,
  onApply,
  onRemove,
  onDone,
}: BulkLabelBarProps) {
  return (
    <div className="sticky bottom-0 mt-4 flex items-center justify-between gap-3 rounded-xl border-t border-border bg-brand-warm px-4 py-3">
      <p className="text-base font-semibold text-foreground" aria-live="polite">
        {selectedCount} selected
      </p>
      <div className="flex items-center gap-2">
        {labels.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" aria-haspopup="menu" disabled={selectedCount === 0} />}
            >
              Labels
              <ChevronDown aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-56" align="end">
              {labels.map((label) => {
                const state = stateFor(label.id);
                return (
                  <DropdownMenuCheckboxItem
                    key={label.id}
                    className="min-h-11 text-base"
                    closeOnClick={false}
                    checked={state === "all"}
                    onCheckedChange={() => (state === "all" ? onRemove(label.id) : onApply(label.id))}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: label.color ?? "var(--color-brand-neutral)" }}
                      aria-hidden="true"
                    />
                    {label.name}
                    {state === "some" && (
                      <span className="ml-auto pl-3 text-sm text-muted-foreground">Some</span>
                    )}
                  </DropdownMenuCheckboxItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button variant="outline" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
