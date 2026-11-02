"use client";

import { useEffect, useState } from "react";
import { getJoinState, msUntilNextJoinTransition, type JoinState } from "@/lib/meetings";

/** Where an occurrence is in its join window, re-evaluated exactly when that next changes. */
export function useJoinState(startTime: string, endTime: string | null, leadMinutes: number): JoinState {
  const [state, setState] = useState<JoinState>(() =>
    getJoinState(new Date(), startTime, endTime, leadMinutes)
  );

  useEffect(() => {
    setState(getJoinState(new Date(), startTime, endTime, leadMinutes));
    const ms = msUntilNextJoinTransition(new Date(), startTime, endTime, leadMinutes);
    if (ms === null) return;
    const timer = setTimeout(
      () => setState(getJoinState(new Date(), startTime, endTime, leadMinutes)),
      ms + 250
    );
    return () => clearTimeout(timer);
  }, [state, startTime, endTime, leadMinutes]);

  return state;
}
