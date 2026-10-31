"use client";

import { useSyncExternalStore } from "react";
import { PHONE_QUERY } from "@/components/events/calendarViewState";

function subscribe(onChange: () => void) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Whether the viewport is phone-width. The server cannot know, so it renders the wider layout. */
export function useIsPhone(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false
  );
}
