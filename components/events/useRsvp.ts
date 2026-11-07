"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { RsvpStatus } from "@/lib/types";
import { logError } from "@/lib/log";

export const RSVP_SAVE_FAILED = "Couldn't save your reply. Try again.";

interface UseRsvpArgs {
  /** The series for any of its dates. */
  eventId: string;
  /** The date's calendar day in the church's zone, from `replyKey()`. */
  occurrenceDate: string;
  userId: string;
  initialStatus: RsvpStatus | null;
}

/**
 * Holds one member's reply to one date of an event. Choosing the current
 * reply again clears it. The picked reply shows at once; a failed write puts
 * the previous reply back and sets `error`.
 */
export function useRsvp({ eventId, occurrenceDate, userId, initialStatus }: UseRsvpArgs) {
  const [status, setStatus] = useState<RsvpStatus | null>(initialStatus);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const supabase = createClient();

  const writeReply = async (next: RsvpStatus | null): Promise<boolean> => {
    // rsvp_set raises when the row policy refuses a save, and a clear names
    // only the caller's own rows, so no error is the proof that it saved.
    const { error } = await supabase.rpc("rsvp_set", {
      _event_id: eventId,
      _occurrence_date: occurrenceDate,
      ...(next === null ? {} : { _status: next }),
    });
    if (error) {
      logError("RSVP write failed", error, { ids: { event: eventId, member: userId } });
      return false;
    }
    return true;
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
