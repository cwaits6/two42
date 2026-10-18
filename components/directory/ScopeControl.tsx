"use client";

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

/** "Show people from" — the scope dropdown above every directory tab. */
export function ScopeControl() {
  const { scope, setScope, options, showControl } = useDirectory();
  if (!showControl) return null;

  return (
    <div className="mb-7 flex flex-wrap items-center gap-3">
      <Label htmlFor="directory-scope" className="text-base text-muted-foreground">
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
        <SelectTrigger id="directory-scope" className="min-w-56 text-base">
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
