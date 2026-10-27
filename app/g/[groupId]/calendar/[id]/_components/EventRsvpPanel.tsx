"use client";

import { useRsvp } from "@/components/events/useRsvp";
import type { RsvpStatus } from "@/lib/types";

interface EventRsvpPanelProps {
  eventId: string;
  userId: string;
  initialStatus: RsvpStatus | null;
}

const OPTIONS: { value: RsvpStatus; label: string }[] = [
  { value: "yes", label: "Going" },
  { value: "maybe", label: "Maybe" },
  { value: "no", label: "Can't" },
];

export function EventRsvpPanel({ eventId, userId, initialStatus }: EventRsvpPanelProps) {
  const { status, saving, error, choose } = useRsvp({ eventId, userId, initialStatus });

  let label = "Have you decided?";
  let accent = false;
  if (status === "yes") { label = "You're going."; accent = true; }
  else if (status === "maybe") label = "Maybe so far.";
  else if (status === "no") label = "You can't make it.";

  return (
    <>
      <div className="font-sans text-[11px] font-bold uppercase tracking-[2px] opacity-85 mb-3">
        Your RSVP
      </div>
      <div className="font-serif text-[26px] font-medium mb-4 leading-snug">
        {label}
        {accent && <span className="ml-2" style={{ color: "var(--color-brand-accent)" }}>✓</span>}
      </div>
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
              className="rounded-[7px] px-3 py-2 text-center text-[13px] font-bold transition-colors disabled:opacity-60"
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
    </>
  );
}
