"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { failureMessage } from "@/lib/errorCopy";

interface SettingSave<T> {
  /**
   * Resolves true only when the write returned a row. RLS filters a row the
   * caller may not update out of the statement, which then succeeds with zero
   * rows, so "no error" is not a save.
   */
  write: (next: T) => Promise<boolean>;
  /** The success toast, in the past tense. */
  saved: (next: T) => string;
  /** The verb and thing for the failure toast, e.g. "save the time zone". */
  action: string;
}

/**
 * How every church setting saves: the moment its control changes. The control
 * shows the new value while the write runs and goes back to the saved one if
 * the write fails, so it never shows a value the church doesn't have.
 */
export function useSettingSave<T>(initial: T, { write, saved, action }: SettingSave<T>) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  // State lags a second change made before the next render; the ref does not.
  const inFlight = useRef(false);
  const router = useRouter();

  /** Resolves true when the setting was saved. */
  async function save(next: T): Promise<boolean> {
    if (inFlight.current) return false;
    inFlight.current = true;
    const previous = value;
    setValue(next);
    setSaving(true);
    const ok = await write(next).catch(() => false);
    inFlight.current = false;
    setSaving(false);
    if (!ok) {
      setValue(previous);
      toast.error(failureMessage(action));
      return false;
    }
    toast.success(saved(next));
    router.refresh();
    return true;
  }

  return { value, saving, save };
}
