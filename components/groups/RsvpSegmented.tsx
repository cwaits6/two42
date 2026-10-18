"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
  const [status, setStatus] = useState<RsvpStatus | null>(currentStatus);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleRsvp = async (newStatus: RsvpStatus) => {
    if (loading) return;
    setLoading(true);
    try {
      if (status === newStatus) {
        const { error } = await supabase
          .from("rsvps")
          .delete()
          .eq("event_id", eventId)
          .eq("user_id", userId);
        if (error) {
          console.error("RSVP delete failed", { eventId, userId, error });
        } else {
          setStatus(null);
        }
      } else {
        const { error } = await supabase.from("rsvps").upsert(
          { event_id: eventId, user_id: userId, status: newStatus },
          { onConflict: "event_id,user_id" }
        );
        if (error) {
          console.error("RSVP upsert failed", { eventId, userId, status: newStatus, error });
        } else {
          setStatus(newStatus);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="grid grid-cols-3 gap-1 rounded-[10px] p-1"
      style={{ background: "rgba(0,0,0,0.18)" }}
    >
      {OPTIONS.map((opt) => {
        const active = status === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => handleRsvp(opt.value)}
            disabled={loading}
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
  );
}
