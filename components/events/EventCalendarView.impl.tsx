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
import { groupTextColor } from "@/lib/groups/settings";
import { buildExceptionMap, expandOccurrences } from "@/lib/recurrence";
import type { CalendarGroup } from "@/components/events/EventsPageClient";
import type { Event } from "@/lib/types";

interface EventCalendarViewProps {
  groups: CalendarGroup[];
  events: Event[];
  visibleGroupIds: Set<string>;
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
  const [currentView, setCurrentView] = useState("dayGridMonth");

  const colors = useMemo(() => new Map(groups.map((g) => [g.id, g.color])), [groups]);

  const filteredEvents: EventInput[] = useMemo(() => {
    // Build the exception map from every event before filtering, so an
    // exception row of a hidden group still suppresses its series occurrence.
    const exceptions = buildExceptionMap(events);

    const expanded: Event[] = [];
    for (const e of events) {
      if (!visibleGroupIds.has(e.group_id)) continue;
      if (e.series_id) {
        expanded.push(e);
      } else if (e.recurrence_frequency) {
        expanded.push(...expandOccurrences(e, exceptions.get(e.id)));
      } else {
        expanded.push(e);
      }
    }

    return expanded.map((e) => {
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
    const event = info.event.extendedProps.event as Event;
    // A recurring occurrence carries its date so the detail and edit pages
    // know which one is meant.
    const occurrence =
      event.recurrence_frequency && !event.series_id
        ? `?occurrence=${encodeURIComponent(event.start_time)}`
        : "";
    router.push(groupPath(event.group_id, `/calendar/${event.id}${occurrence}`));
  };

  const handleDateClick = (info: DateClickArg) => {
    if (!onDateClick) return;
    onDateClick(info.dateStr.split("T")[0]);
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
          timeZone="local"
          events={filteredEvents}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          datesSet={handleDatesSet}
          selectable={!!onDateClick}
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
