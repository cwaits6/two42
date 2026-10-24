"use client";

import { useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { EventClickArg, EventInput } from "@fullcalendar/core";
import type { DateClickArg } from "@fullcalendar/interaction";
import { groupTextColor } from "@/lib/groups/settings";
import type { CalendarGroup } from "@/components/events/EventsPageClient";
import { eventDetailHref, expandVisibleEvents } from "@/components/events/visibleEvents";
import type { Event } from "@/lib/types";

interface EventCalendarViewProps {
  groups: CalendarGroup[];
  events: Event[];
  visibleGroupIds: ReadonlySet<string>;
  /** A day click creates an event when the viewer leads exactly one visible group. */
  onDateClick?: (date: string) => void;
}

export default function EventCalendarView({
  groups,
  events,
  visibleGroupIds,
  onDateClick,
}: EventCalendarViewProps) {
  const router = useRouter();
  const calendarRef = useRef<FullCalendar>(null);

  const colors = useMemo(() => new Map(groups.map((g) => [g.id, g.color])), [groups]);

  const filteredEvents: EventInput[] = useMemo(() => {
    return expandVisibleEvents(events, visibleGroupIds).map((e) => {
      const color = colors.get(e.group_id) ?? "var(--color-brand-primary)";
      return {
        id: e.id,
        title: e.title,
        start: e.start_time,
        end: e.end_time ?? undefined,
        backgroundColor: color,
        borderColor: color,
        textColor: colors.has(e.group_id) ? groupTextColor(color) : undefined,
        extendedProps: { event: e },
      };
    });
  }, [events, visibleGroupIds, colors]);

  const handleEventClick = (info: EventClickArg) => {
    router.push(eventDetailHref(info.event.extendedProps.event as Event));
  };

  const handleDateClick = (info: DateClickArg) => {
    if (!onDateClick) return;
    onDateClick(info.dateStr.split("T")[0]);
  };

  return (
    <div className="bg-white rounded-[2rem] border-2 border-border overflow-hidden p-5 shadow-sm [&_.fc-event]:cursor-pointer">
      <div className="rounded-[1.5rem] border border-slate-100 bg-slate-50/70 p-4 md:p-5">
        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={() => calendarRef.current?.getApi().prev()}
            className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors hover:border-brand-primary/30 hover:text-brand-primary"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => calendarRef.current?.getApi().next()}
            className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors hover:border-brand-primary/30 hover:text-brand-primary"
            aria-label="Next month"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{ left: "today", center: "title", right: "" }}
          timeZone="local"
          events={filteredEvents}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          selectable={!!onDateClick}
          height="auto"
          buttonText={{ today: "Today" }}
        />
      </div>
    </div>
  );
}
