"use client";

import { useSyncExternalStore } from "react";

const COARSE_POINTER = "(pointer: coarse)";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(COARSE_POINTER);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the main pointer is a finger (phones and tablets). Null on the
 * server and during hydration, so nothing that depends on it is in the
 * server markup.
 */
export function useCoarsePointer(): boolean | null {
  return useSyncExternalStore<boolean | null>(
    subscribe,
    () => window.matchMedia(COARSE_POINTER).matches,
    () => null
  );
}
