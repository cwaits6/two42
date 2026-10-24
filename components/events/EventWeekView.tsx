"use client";

import dynamic from "next/dynamic";

// Client-only, like the Month view: the week's first day comes from the
// browser locale and "today" from the browser clock, neither of which the
// server can know.
export const EventWeekView = dynamic(() => import("./EventWeekView.impl"), {
  ssr: false,
  loading: () => (
    <div className="bg-white rounded-[2rem] border-2 border-border overflow-hidden p-2 shadow-sm md:p-5">
      <div className="h-[560px] rounded-[1.5rem] border border-slate-100 bg-slate-50/70 animate-pulse" />
    </div>
  ),
});
