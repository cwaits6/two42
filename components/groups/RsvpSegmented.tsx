"use client";

import { useRsvp } from "@/components/events/useRsvp";
import type { RsvpStatus } from "@/lib/types";

interface RsvpSegmentedProps {
  eventId: string;
  userId: string;
  currentStatus: RsvpStatus | null;
}

const OPTIONS: { value: RsvpStatus; label: string }[] = [
  { value: "yes", label: "Going" },
  { value: "maybe", label: "Maybe" },
  { value: "no", label: "Can't" },
];

export function RsvpSegmented({ eventId, userId, currentStatus }: RsvpSegmentedProps) {
  const { status, saving, error, choose } = useRsvp({
    eventId,
    userId,
    initialStatus: currentStatus,
  });

  return (
    <div>
      <div
        className="grid grid-cols-3 gap-1 rounded-[10px] p-1"
        style={{ background: "rgba(0,0,0,0.18)" }}
      >
        {OPTIONS.map((opt) => {
          const active = status === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => choose(opt.value)}
              disabled={saving}
              aria-pressed={active}
              className="rounded-[7px] px-3 min-h-12 flex items-center justify-center text-center text-base font-bold transition-colors disabled:opacity-60"
              style={{
                background: active ? "var(--color-brand-accent)" : "transparent",
                color: active ? "var(--foreground)" : "rgba(255,255,255,0.85)",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-base font-semibold text-white">
          {error}
        </p>
      )}
    </div>
  );
}
