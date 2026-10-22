"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { groupTextColor } from "@/lib/groups/settings";
import type { CalendarGroup } from "@/components/events/EventsPageClient";
import { eventDetailHref, expandVisibleEvents } from "@/components/events/visibleEvents";
import {
  GRID_MINUTES,
  HOUR_HEIGHT_PX,
  addDays,
  dayKey,
  formatTime,
  gridHours,
  layoutLanes,
  localeWeekStart,
  placeEvent,
  weekDays,
  weekTitle,
  type Lane,
} from "@/components/events/weekGrid";
import type { Event } from "@/lib/types";

interface EventWeekViewProps {
  groups: CalendarGroup[];
  events: Event[];
  visibleGroupIds: ReadonlySet<string>;
}

type Block = {
  key: string;
  href: string;
  title: string;
  time: string;
  tooltip: string;
  color: string;
  textColor: string;
};

type TimedBlock = Block & { topMinutes: number; durationMinutes: number; lane: Lane };

type DayColumn = { date: Date; key: string; allDay: Block[]; timed: TimedBlock[] };

const navButtonClass =
  "flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors hover:border-brand-primary/30 hover:text-brand-primary";

export default function EventWeekView({ groups, events, visibleGroupIds }: EventWeekViewProps) {
  const firstDay = useMemo(() => localeWeekStart(navigator.language), []);
  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const todayKey = dayKey(new Date());
  const days = useMemo(() => weekDays(anchor, firstDay), [anchor, firstDay]);
  const inWeek = (key: string) => days.some((d) => dayKey(d) === key);
  const phoneKey =
    selectedKey && inWeek(selectedKey) ? selectedKey : inWeek(todayKey) ? todayKey : dayKey(days[0]);

  const columns = useMemo(
    () => buildColumns(days, groups, expandVisibleEvents(events, visibleGroupIds)),
    [days, groups, events, visibleGroupIds]
  );
  const phoneColumn = columns.find((c) => c.key === phoneKey) ?? columns[0];

  const goTo = (date: Date) => {
    setAnchor(date);
    setSelectedKey(null);
  };

  return (
    <div className="bg-white rounded-[2rem] border-2 border-border overflow-hidden p-2 shadow-sm md:p-5">
      <div className="md:rounded-[1.5rem] md:border md:border-slate-100 md:bg-slate-50/70 md:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => goTo(addDays(anchor, -7))} className={navButtonClass} aria-label="Previous week">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button type="button" onClick={() => goTo(addDays(anchor, 7))} className={navButtonClass} aria-label="Next week">
            <ChevronRight className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={() => goTo(new Date())}
            className="h-12 cursor-pointer rounded-full border border-slate-200 bg-white px-5 text-base font-semibold text-slate-600 transition-colors hover:border-brand-primary/30 hover:text-brand-primary"
          >
            Today
          </button>
          <h2 className="ml-auto font-display text-xl font-bold text-slate-800 md:text-2xl" aria-live="polite">
            {weekTitle(days)}
          </h2>
        </div>

        <div className="md:hidden">
          <div role="tablist" aria-label="Day" className="mb-3 grid grid-cols-7 gap-0.5">
            {columns.map((column) => {
              const selected = column.key === phoneKey;
              const isToday = column.key === todayKey;
              return (
                <button
                  key={column.key}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-current={isToday ? "date" : undefined}
                  onClick={() => setSelectedKey(column.key)}
                  className={`flex min-h-14 flex-col items-center justify-center rounded-xl border-2 text-base leading-tight transition-colors ${
                    selected
                      ? "border-brand-primary bg-brand-primary text-white"
                      : isToday
                        ? "border-brand-primary bg-white text-brand-primary"
                        : "border-transparent bg-white text-slate-700 hover:border-slate-300"
                  }`}
                >
                  <span className="font-medium">
                    {column.date.toLocaleDateString("en-US", { weekday: "short" })}
                  </span>
                  <span className="font-display text-xl font-bold">{column.date.getDate()}</span>
                </button>
              );
            })}
          </div>
          <WeekGrid columns={[phoneColumn]} todayKey={todayKey} />
        </div>

        <div className="hidden md:block">
          <WeekGrid columns={columns} todayKey={todayKey} />
        </div>
      </div>
    </div>
  );
}

function buildColumns(days: Date[], groups: CalendarGroup[], occurrences: Event[]): DayColumn[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const columns = new Map<string, DayColumn>(
    days.map((date) => [dayKey(date), { date, key: dayKey(date), allDay: [], timed: [] }])
  );
  for (const event of occurrences) {
    const start = new Date(event.start_time);
    const column = columns.get(dayKey(start));
    if (!column) continue;
    const group = byId.get(event.group_id);
    const color = group?.color ?? "var(--color-brand-primary)";
    const time = formatTime(start);
    const block: Block = {
      key: `${event.id}-${event.start_time}`,
      href: eventDetailHref(event),
      title: event.title,
      time,
      tooltip: `${time} · ${event.title}${group ? ` · ${group.name}` : ""}`,
      color,
      textColor: group ? groupTextColor(group.color) : "#FFFFFF",
    };
    const placement = placeEvent(start, event.end_time ? new Date(event.end_time) : null);
    if (placement.kind === "allDay") {
      column.allDay.push(block);
    } else {
      column.timed.push({ ...block, ...placement, lane: { lane: 0, laneCount: 1 } });
    }
  }

  for (const column of columns.values()) {
    const lanes = layoutLanes(column.timed);
    column.timed = column.timed.map((block, i) => ({ ...block, lane: lanes[i] }));
  }
  return [...columns.values()];
}

const HOURS = gridHours();
const GRID_HEIGHT_PX = (GRID_MINUTES / 60) * HOUR_HEIGHT_PX;
const minutesToPx = (minutes: number) => (minutes / 60) * HOUR_HEIGHT_PX;

function WeekGrid({ columns, todayKey }: { columns: DayColumn[]; todayKey: string }) {
  const template = { gridTemplateColumns: `5.5rem repeat(${columns.length}, minmax(0, 1fr))` };
  const todayTint = (key: string) => (key === todayKey ? "bg-brand-bg-light/50" : "");

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="grid border-b border-slate-200" style={template}>
        <div aria-hidden="true" />
        {columns.map((column) => (
          <div
            key={column.key}
            className={`flex flex-col items-center border-l border-slate-200 py-2 text-base leading-tight ${todayTint(column.key)} ${
              column.key === todayKey ? "text-brand-primary" : "text-slate-700"
            }`}
          >
            <span className="font-medium">
              {column.date.toLocaleDateString("en-US", { weekday: "short" })}
            </span>
            <span className="font-display text-2xl font-bold">{column.date.getDate()}</span>
            {column.key === todayKey && <span className="sr-only">Today</span>}
          </div>
        ))}
      </div>

      <div className="grid border-b border-slate-200" style={template}>
        <div className="px-2 py-2 text-right font-mono text-base text-slate-500">All day</div>
        {columns.map((column) => (
          <div
            key={column.key}
            className={`flex min-h-14 flex-col gap-1 border-l border-slate-200 p-1 ${todayTint(column.key)}`}
          >
            {column.allDay.map((block) => (
              <Link
                key={block.key}
                href={block.href}
                title={block.tooltip}
                aria-label={block.tooltip}
                className="block min-h-11 truncate rounded-lg px-2 py-2 text-base font-semibold leading-snug"
                style={{ backgroundColor: block.color, color: block.textColor }}
              >
                {block.title}
              </Link>
            ))}
          </div>
        ))}
      </div>

      <div className="grid" style={template}>
        <div className="relative" style={{ height: GRID_HEIGHT_PX }} aria-hidden="true">
          {HOURS.map(({ hour, label }) => (
            <span
              key={hour}
              className="absolute right-2 -translate-y-1/2 font-mono text-base text-slate-500"
              style={{ top: minutesToPx((hour - HOURS[0].hour) * 60) }}
            >
              {label}
            </span>
          ))}
        </div>
        {columns.map((column) => (
          <div
            key={column.key}
            className={`relative border-l border-slate-200 ${todayTint(column.key)}`}
            style={{ height: GRID_HEIGHT_PX }}
          >
            {HOURS.map(({ hour }) => (
              <div
                key={hour}
                aria-hidden="true"
                className="absolute inset-x-0 border-t border-slate-200"
                style={{ top: minutesToPx((hour - HOURS[0].hour) * 60) }}
              />
            ))}
            {column.timed.map((block) => (
              <Link
                key={block.key}
                href={block.href}
                title={block.tooltip}
                aria-label={block.tooltip}
                className="absolute overflow-hidden rounded-lg border border-white/70 px-1.5 py-0.5 text-base leading-tight shadow-sm"
                style={{
                  top: minutesToPx(block.topMinutes),
                  height: minutesToPx(block.durationMinutes),
                  minHeight: 44,
                  left: `calc(${(block.lane.lane / block.lane.laneCount) * 100}% + 2px)`,
                  width: `calc(${100 / block.lane.laneCount}% - 4px)`,
                  backgroundColor: block.color,
                  color: block.textColor,
                }}
              >
                <span className="block font-semibold">{block.time}</span>
                <span className="block">{block.title}</span>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
