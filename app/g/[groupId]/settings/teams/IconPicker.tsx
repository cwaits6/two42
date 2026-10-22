"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { DynamicIcon, iconNames, type IconName } from "lucide-react/dynamic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronUp, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { GroupIcon } from "@/components/directory/GroupIcon";

const NAME_SET = new Set<string>(iconNames);

/** Church-relevant starting points shown before the admin searches */
const SUGGESTED = [
  "users",
  "heart",
  "hand-helping",
  "cross",
  "church",
  "book-open",
  "music",
  "star",
  "baby",
  "shield",
  "bell",
  "flag",
  "handshake",
  "coffee",
  "utensils",
  "gift",
  "sun",
  "phone",
  "calendar",
  "house",
  "car",
  "graduation-cap",
  "sprout",
  "globe",
].filter((n) => NAME_SET.has(n)) as IconName[];

const MAX_RESULTS = 96;

function prettyName(name: string): string {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface IconPickerProps {
  value: string;
  onChange: (name: string) => void;
}

/**
 * Searchable picker over the full lucide catalog. Collapsed it shows the
 * current icon; expanded it shows suggestions, or search results capped at
 * MAX_RESULTS so we never fetch hundreds of icon chunks at once.
 */
export function IconPicker({ value, onChange }: IconPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Dismiss on outside press or Escape, matching the app's menus/dialogs so the
  // picker doesn't linger when the admin clicks away from it.
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        // Return focus to the trigger so keyboard users don't land on <body>.
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const { results, total } = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return { results: SUGGESTED, total: SUGGESTED.length };
    const matches = iconNames.filter((n) => n.includes(q));
    return { results: matches.slice(0, MAX_RESULTS), total: matches.length };
  }, [query]);

  function pick(name: IconName) {
    onChange(name);
    setOpen(false);
    setQuery("");
  }

  return (
    <div className="space-y-2" ref={containerRef}>
      <Button
        ref={triggerRef}
        type="button"
        variant="outline"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full justify-between font-normal"
      >
        <span className="flex items-center gap-2">
          <GroupIcon name={value} className="h-4 w-4" />
          {value ? prettyName(value) : "Choose an icon"}
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </Button>

      {open && (
        <div className="rounded-lg border p-2 space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="search"
              autoFocus
              placeholder="Search all icons..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground py-3 text-center">
              No icons match &ldquo;{query.trim()}&rdquo;.
            </p>
          ) : (
            <div className="grid grid-cols-8 gap-1 max-h-48 overflow-y-auto">
              {results.map((n) => (
                <button
                  key={n}
                  type="button"
                  title={prettyName(n)}
                  aria-label={prettyName(n)}
                  aria-pressed={n === value}
                  onClick={() => pick(n)}
                  className={cn(
                    "flex h-9 items-center justify-center rounded-md hover:bg-accent transition-colors",
                    n === value && "bg-accent ring-1 ring-brand-primary",
                  )}
                >
                  <DynamicIcon name={n} className="h-4 w-4" />
                </button>
              ))}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {query.trim()
              ? total > MAX_RESULTS
                ? `Showing ${MAX_RESULTS} of ${total} matches — keep typing to narrow down.`
                : `${total} match${total !== 1 ? "es" : ""}`
              : "Suggestions — search to browse all 1,900+ icons."}
          </p>
        </div>
      )}
    </div>
  );
}
