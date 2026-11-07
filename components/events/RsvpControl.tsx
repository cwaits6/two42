"use client";

import { Check } from "lucide-react";
import { useRsvp } from "@/components/events/useRsvp";
import { cn } from "@/lib/utils";
import type { RsvpStatus } from "@/lib/types";

export const RSVP_OPTIONS: { value: RsvpStatus; label: string }[] = [
  { value: "yes", label: "Going" },
  { value: "maybe", label: "Maybe" },
  { value: "no", label: "Can't go" },
];

interface RsvpControlProps {
  /** The series for any of its dates; see `replyKey()`. */
  eventId: string;
  occurrenceDate: string;
  userId: string;
  currentStatus: RsvpStatus | null;
  /** `primary` sits on a Clay fill (the event card); `default` on a light card; `quiet` on a light card that keeps its Clay for something else. */
  tone?: "default" | "primary" | "quiet";
}

const TONES = {
  default: {
    chosen: "border-primary bg-primary text-primary-foreground",
    open: "border-border bg-card text-foreground hover:bg-muted",
    error: "text-destructive",
  },
  primary: {
    chosen: "border-brand-accent bg-brand-accent text-foreground",
    open: "border-white/60 bg-transparent text-white hover:bg-primary-foreground/15",
    error: "font-semibold text-white",
  },
  quiet: {
    chosen: "border-brand-primary-text bg-brand-warm text-brand-primary-text",
    open: "border-border bg-card text-foreground hover:bg-muted",
    error: "text-destructive",
  },
} as const;

/** The one reply control for a date of an event. The chosen reply carries a check and aria-pressed, never color alone. */
export function RsvpControl({ eventId, occurrenceDate, userId, currentStatus, tone = "default" }: RsvpControlProps) {
  const { status, saving, error, choose } = useRsvp({
    eventId,
    occurrenceDate,
    userId,
    initialStatus: currentStatus,
  });
  const styles = TONES[tone];

  return (
    <div>
      <div role="group" aria-label="Your reply" className="grid grid-cols-3 gap-2">
        {RSVP_OPTIONS.map((option) => {
          const chosen = status === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => choose(option.value)}
              disabled={saving}
              aria-pressed={chosen}
              className={cn(
                "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-semibold whitespace-nowrap transition-colors disabled:opacity-60",
                chosen ? styles.chosen : styles.open,
              )}
            >
              {chosen && <Check className="h-5 w-5 shrink-0" aria-hidden="true" />}
              {option.label}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className={cn("mt-2 text-base", styles.error)}>
          {error}
        </p>
      )}
    </div>
  );
}
