"use client";

import dynamic from "next/dynamic";

// Client-only, like the Month view: the week's first day comes from the
// browser locale and "today" from the browser clock, neither of which the
// server can know. The calendar day an event lands on comes from the org zone.
export const EventWeekView = dynamic(() => import("./EventWeekView.impl"), {
  ssr: false,
  loading: () => (
    <div className="mt-16 h-[560px] rounded-2xl border border-border bg-muted animate-pulse" />
  ),
});
