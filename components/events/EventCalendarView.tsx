"use client";

import dynamic from "next/dynamic";

export const EventCalendarView = dynamic(
  () => import("./EventCalendarView.impl"),
  {
    ssr: false,
    loading: () => (
      <div className="mt-16 h-[560px] rounded-2xl border border-border bg-muted animate-pulse" />
    ),
  },
);
