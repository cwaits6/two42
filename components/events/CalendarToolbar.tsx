"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CALENDAR_VIEWS, type CalendarView } from "@/components/events/calendarViewState";
import { cn } from "@/lib/utils";

export type CalendarNav = {
  /** The period on screen, e.g. "October 2026". */
  title: string;
  /** "month" or "week", for the arrow buttons' names. */
  unit: string;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
};

/** One row above every view: the view switch, then the period and its arrows when the view pages through time. */
export function CalendarToolbar({ viewSwitch, nav }: { viewSwitch: ReactNode; nav?: CalendarNav }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
      {viewSwitch}
      {nav && (
        <>
          <h2
            className="min-w-0 flex-1 truncate font-serif text-xl font-medium text-foreground md:text-center md:text-2xl"
            aria-live="polite"
          >
            {nav.title}
          </h2>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" onClick={nav.onPrev} aria-label={`Previous ${nav.unit}`}>
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button variant="outline" size="sm" className="px-4 text-base" onClick={nav.onToday}>
              Today
            </Button>
            <Button variant="outline" size="icon-sm" onClick={nav.onNext} aria-label={`Next ${nav.unit}`}>
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Month / Week / List as a radiogroup: arrow keys move the checked view and its focus.
 * Each view renders its own switch, so a change mounts a new one; `focusOnMount`
 * hands focus to it rather than letting it fall to the page.
 */
export function CalendarViewSwitch({
  view,
  onChange,
  focusOnMount = false,
}: {
  view: CalendarView;
  onChange: (view: CalendarView) => void;
  focusOnMount?: boolean;
}) {
  const group = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusOnMount) group.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
  }, [focusOnMount]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const index = CALENDAR_VIEWS.findIndex((v) => v.value === view);
    const next = CALENDAR_VIEWS[(index + step + CALENDAR_VIEWS.length) % CALENDAR_VIEWS.length];
    onChange(next.value);
    const radios = e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]');
    radios[CALENDAR_VIEWS.indexOf(next)]?.focus();
  };

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label="View"
      onKeyDown={onKeyDown}
      className="inline-flex shrink-0 items-center gap-1 rounded-xl border border-border bg-card p-1"
    >
      {CALENDAR_VIEWS.map((option) => {
        const checked = view === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "min-h-11 rounded-lg px-4 text-base font-semibold transition-colors",
              checked
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
