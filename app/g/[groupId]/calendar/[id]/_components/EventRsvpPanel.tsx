"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
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
  const [status, setStatus] = useState<RsvpStatus | null>(initialStatus);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  const handleRsvp = async (newStatus: RsvpStatus) => {
    if (loading) return;
    const prev = status;
    const next = prev === newStatus ? null : newStatus;
    setStatus(next);
    setLoading(true);
    try {
      const { error } =
        next === null
          ? await supabase
              .from("rsvps")
              .delete()
              .eq("event_id", eventId)
              .eq("user_id", userId)
          : await supabase.from("rsvps").upsert(
              { event_id: eventId, user_id: userId, status: next },
              { onConflict: "event_id,user_id" }
            );
      if (error) throw error;
    } catch (err) {
      console.error("Failed to update RSVP", err);
      setStatus(prev);
    } finally {
      setLoading(false);
    }
  };

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
              onClick={() => handleRsvp(opt.value)}
              disabled={loading}
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
    </>
  );
}
