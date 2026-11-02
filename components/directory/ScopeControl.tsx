"use client";

import { usePathname } from "next/navigation";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDirectory } from "@/components/directory/DirectoryContext";
import { scopeValue } from "@/components/directory/scope";

/**
 * "Show people from" — the scope dropdown above the people tabs. The Groups
 * tab lists groups, not people, and ignores the scope, so it hides the control.
 */
export function ScopeControl() {
  const { scope, setScope, options, showControl } = useDirectory();
  const onGroupsTab = usePathname().endsWith("/groups");
  if (!showControl || onGroupsTab) return null;

  return (
    <div className="mb-4 flex items-center gap-3">
      <Label htmlFor="directory-scope" className="shrink-0 whitespace-nowrap text-base text-muted-foreground">
        Show people from
      </Label>
      <Select
        items={options}
        value={scopeValue(scope)}
        onValueChange={(value) => {
          const next = options.find((o) => o.value === value);
          if (next) setScope(next.scope);
        }}
      >
        <SelectTrigger id="directory-scope" className="w-auto min-w-0 flex-1 text-base sm:min-w-56 sm:flex-none">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
