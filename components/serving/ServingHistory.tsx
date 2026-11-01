"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatServingDate } from "@/lib/serving/dates";
import type { ScheduleEntry } from "./ServingSchedule";

export interface HistoryEntry {
  date: string;
  entry: ScheduleEntry | null;
}

interface ServingHistoryProps {
  entries: HistoryEntry[];
  /** Today in the church's time zone, "YYYY-MM-DD" */
  today: string;
}

export function ServingHistory({ entries, today }: ServingHistoryProps) {
  const [open, setOpen] = useState(false);

  if (!entries.length) return null;

  return (
    <div className="mt-10 border-t border-border pt-8">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-11 items-center gap-2 text-base font-semibold text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? <ChevronUp className="h-5 w-5" aria-hidden="true" /> : <ChevronDown className="h-5 w-5" aria-hidden="true" />}
        Past dates ({entries.length})
      </button>

      {open && (
        <ul className="mt-4 divide-y divide-border">
          {entries.map(({ date, entry }) => (
            <li key={date} className="flex items-center justify-between py-3 gap-4">
              <span className="text-base text-muted-foreground shrink-0">
                {formatServingDate(date, today)}
              </span>
              <span
                className={
                  entry
                    ? "text-base font-medium text-foreground text-right"
                    : "text-base text-muted-foreground text-right"
                }
              >
                {entry ? entry.label : "No one signed up"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
