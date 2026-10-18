"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import interactionPlugin from "@fullcalendar/interaction";
import type { DatesSetArg, EventClickArg, EventInput } from "@fullcalendar/core";
import type { DateClickArg } from "@fullcalendar/interaction";
import { groupPath } from "@/lib/groups/active";
import { buildExceptionMap, expandOccurrences } from "@/lib/recurrence";
import type { Event, EventCalendar } from "@/lib/types";

interface EventCalendarViewProps {
  groupId: string;
  events: (Event & { calendar?: EventCalendar | null })[];
  visibleCalendarIds: Set<string | null>;
  isAdmin?: boolean;
}

export default function EventCalendarView({
  groupId,
  events,
  visibleCalendarIds,
  isAdmin,
}: EventCalendarViewProps) {
  const router = useRouter();
  const calendarRef = useRef<FullCalendar>(null);
  const [currentView, setCurrentView] = useState("dayGridMonth");

  const filteredEvents: EventInput[] = useMemo(() => {
    // Build exception map from all events before filtering by calendar visibility,
    // so exception rows for hidden calendars still suppress their series occurrences.
    const exceptions = buildExceptionMap(events);

    const expanded: (Event & { calendar?: EventCalendar | null })[] = [];

    for (const e of events) {
      if (!visibleCalendarIds.has(e.calendar_id)) continue;

      if (e.series_id) {
        // Exception event — include directly (not expanded as a series)
        expanded.push(e);
      } else if (e.recurrence_frequency) {
        // Recurring series — expand, skipping exception-covered dates
        expanded.push(...expandOccurrences(e, exceptions.get(e.id)));
      } else {
        expanded.push(e);
      }
    }

    return expanded.map((e) => {
      const color = e.calendar?.color ?? "var(--color-brand-primary)";
      return {
        id: e.id,
        title: e.title,
        start: e.start_time,
        end: e.end_time ?? undefined,
        backgroundColor: color,
        borderColor: color,
        extendedProps: { event: e },
      };
    });
  }, [events, visibleCalendarIds]);

  const handleEventClick = (info: EventClickArg) => {
    const event = info.event.extendedProps.event as Event;

    if (event.recurrence_frequency && !event.series_id) {
      // Recurring series occurrence — pass the occurrence date so the detail
      // page and edit page know which specific occurrence is being viewed.
      const occurrence = encodeURIComponent(event.start_time);
      router.push(groupPath(groupId, `/calendar/${event.id}?occurrence=${occurrence}`));
    } else {
      // Regular event or per-occurrence exception
      router.push(groupPath(groupId, `/calendar/${event.id}`));
    }
  };

  const handleDateClick = (info: DateClickArg) => {
    if (!isAdmin) return;
    const date = info.dateStr.split("T")[0]; // normalize to YYYY-MM-DD
    router.push(`/admin/events/new?date=${date}`);
  };

  const handleDatesSet = (arg: DatesSetArg) => {
    setCurrentView(arg.view.type);
  };

  useEffect(() => {
    if (currentView !== "timeGridWeek") return;

    const timeoutId = window.setTimeout(() => {
      calendarRef.current?.getApi().scrollToTime("08:00:00");
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [currentView]);

  const navUnit = currentView === "timeGridWeek" ? "week" : "month";

  return (
    <div className="bg-white rounded-[2rem] border-2 border-border overflow-hidden p-5 shadow-sm [&_.fc-event]:cursor-pointer">
      <div className="rounded-[1.5rem] border border-slate-100 bg-slate-50/70 p-4 md:p-5">
        {/* Custom navigation buttons */}
        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={() => calendarRef.current?.getApi().prev()}
            className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors hover:border-brand-primary/30 hover:text-brand-primary"
            aria-label={`Previous ${navUnit}`}
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => calendarRef.current?.getApi().next()}
            className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors hover:border-brand-primary/30 hover:text-brand-primary"
            aria-label={`Next ${navUnit}`}
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>

        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="dayGridMonth"
          headerToolbar={{
            left: "today",
            center: "title",
            right: "dayGridMonth,timeGridWeek",
          }}
          timeZone="America/New_York"
          events={filteredEvents}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          datesSet={handleDatesSet}
          selectable={isAdmin}
          height={currentView === "timeGridWeek" ? 760 : "auto"}
          scrollTime="08:00:00"
          buttonText={{
            today: "Today",
            month: "Month",
            week: "Week",
          }}
          views={{
            timeGridWeek: {
              slotMinTime: "00:00:00",
              slotMaxTime: "24:00:00",
            },
          }}
        />
      </div>
    </div>
  );
}
