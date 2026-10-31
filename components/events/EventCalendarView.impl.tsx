"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin from "@fullcalendar/interaction";
import luxonPlugin from "@fullcalendar/luxon3";
import type { EventClickArg, EventContentArg, EventInput } from "@fullcalendar/core";
import type { DateClickArg } from "@fullcalendar/interaction";
import { blockStyle } from "@/components/events/blockStyle";
import { CalendarToolbar } from "@/components/events/CalendarToolbar";
import type { CalendarGroup } from "@/components/events/EventsPageClient";
import { eventDetailHref, expandVisibleEvents } from "@/components/events/visibleEvents";
import type { Event } from "@/lib/types";

interface EventCalendarViewProps {
  groups: CalendarGroup[];
  events: Event[];
  visibleGroupIds: ReadonlySet<string>;
  /** A day click creates an event when the viewer leads exactly one visible group. */
  onDateClick?: (date: string) => void;
  /** The org's zone, resolved by the server. The luxon plugin is what lets FullCalendar honour a named zone. */
  timeZone: string;
  viewSwitch: ReactNode;
  /** Phone width: one-letter weekday headers so seven columns fit. */
  compact: boolean;
}

// FullCalendar's own skin, mapped onto the palette. Its header toolbar is off:
// CalendarToolbar replaces it.
const THEME = [
  "[--fc-border-color:var(--border)]",
  "[--fc-page-bg-color:var(--card)]",
  "[--fc-neutral-bg-color:var(--muted)]",
  "[--fc-today-bg-color:color-mix(in_srgb,var(--color-brand-bg-light)_60%,transparent)]",
  "[&_.fc]:font-sans",
  "[&_.fc-col-header-cell]:py-2",
  "[&_.fc-col-header-cell-cushion]:text-base [&_.fc-col-header-cell-cushion]:font-semibold [&_.fc-col-header-cell-cushion]:text-muted-foreground",
  "[&_.fc-daygrid-day-number]:text-base [&_.fc-daygrid-day-number]:text-foreground",
  "[&_.fc-day-today_.fc-daygrid-day-number]:font-bold [&_.fc-day-today_.fc-daygrid-day-number]:text-brand-primary-text",
  "[&_.fc-day-other_.fc-daygrid-day-top]:opacity-100! [&_.fc-day-other_.fc-daygrid-day-number]:text-muted-foreground",
  "[&_.fc-daygrid-event]:cursor-pointer [&_.fc-daygrid-event]:rounded-md",
].join(" ");

export default function EventCalendarView({
  groups,
  events,
  visibleGroupIds,
  onDateClick,
  timeZone,
  viewSwitch,
  compact,
}: EventCalendarViewProps) {
  const router = useRouter();
  const calendarRef = useRef<FullCalendar>(null);
  const [title, setTitle] = useState("");

  const colors = useMemo(() => new Map(groups.map((g) => [g.id, g.color])), [groups]);

  const filteredEvents: EventInput[] = useMemo(() => {
    return expandVisibleEvents(events, visibleGroupIds, timeZone).map((e) => {
      const color = colors.get(e.group_id) ?? "var(--color-brand-primary)";
      const style = blockStyle(color);
      return {
        id: e.id,
        title: e.title,
        start: e.start_time,
        end: e.end_time ?? undefined,
        backgroundColor: String(style.backgroundColor),
        borderColor: color,
        textColor: String(style.color),
        extendedProps: { event: e },
      };
    });
  }, [events, visibleGroupIds, timeZone, colors]);

  const api = () => calendarRef.current?.getApi();

  const handleEventClick = (info: EventClickArg) => {
    router.push(eventDetailHref(info.event.extendedProps.event as Event));
  };

  const handleDateClick = (info: DateClickArg) => {
    if (!onDateClick) return;
    onDateClick(info.dateStr.split("T")[0]);
  };

  return (
    <div>
      <CalendarToolbar
        viewSwitch={viewSwitch}
        nav={{
          title,
          unit: "month",
          onPrev: () => api()?.prev(),
          onNext: () => api()?.next(),
          onToday: () => api()?.today(),
        }}
      />
      <div className={`overflow-hidden rounded-2xl border border-border bg-card p-2 md:p-4 ${THEME}`}>
        <FullCalendar
          ref={calendarRef}
          plugins={[dayGridPlugin, interactionPlugin, luxonPlugin]}
          initialView="dayGridMonth"
          headerToolbar={false}
          datesSet={(arg) => setTitle(arg.view.title)}
          dayHeaderFormat={{ weekday: compact ? "narrow" : "short" }}
          timeZone={timeZone}
          events={filteredEvents}
          eventDisplay="block"
          eventContent={renderEvent}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          selectable={!!onDateClick}
          height="auto"
        />
      </div>
    </div>
  );
}

/** Time and title wrap inside the cell rather than being clipped mid-word. */
function renderEvent(arg: EventContentArg) {
  return (
    <span className="block whitespace-normal px-1 py-0.5 text-sm leading-snug">
      {arg.timeText && <span className="font-semibold">{arg.timeText} </span>}
      {arg.event.title}
    </span>
  );
}
