"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RsvpStatus } from "@/lib/types";

export const RSVP_SAVE_FAILED = "Couldn't save your reply. Try again.";

interface UseRsvpArgs {
  eventId: string;
  userId: string;
  initialStatus: RsvpStatus | null;
}

/**
 * Holds one member's reply to one event. Choosing the current reply again
 * clears it. The picked reply shows at once; a failed write puts the
 * previous reply back and sets `error`.
 */
export function useRsvp({ eventId, userId, initialStatus }: UseRsvpArgs) {
  const [status, setStatus] = useState<RsvpStatus | null>(initialStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  const writeReply = async (next: RsvpStatus | null): Promise<boolean> => {
    // A write the row policy refuses matches zero rows and reports no error,
    // so the returned rows are the proof that the reply saved.
    const { data, error } =
      next === null
        ? await supabase
            .from("rsvps")
            .delete()
            .eq("event_id", eventId)
            .eq("user_id", userId)
            .select("user_id")
        : await supabase
            .from("rsvps")
            .upsert(
              { event_id: eventId, user_id: userId, status: next },
              { onConflict: "event_id,user_id" },
            )
            .select("user_id");
    if (error) {
      console.error("RSVP write failed", { eventId, userId, status: next, error });
      return false;
    }
    return (data?.length ?? 0) > 0;
  };

  const choose = async (picked: RsvpStatus) => {
    if (saving) return;
    const previous = status;
    const next = previous === picked ? null : picked;
    setSaving(true);
    setError(null);
    setStatus(next);
    try {
      if (!(await writeReply(next))) {
        setStatus(previous);
        setError(RSVP_SAVE_FAILED);
      }
    } finally {
      setSaving(false);
    }
  };

  return { status, saving, error, choose };
}
