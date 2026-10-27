import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AddToCalendarButton } from "@/components/events/AddToCalendarButton";
import { RsvpButton } from "@/components/events/RsvpButton";
import { CalendarDays, Clock, MapPin, Pencil, Plus } from "lucide-react";
import { groupPath } from "@/lib/groups/active";
import { groupTextColor } from "@/lib/groups/settings";
import { formatEventDate, formatEventRange, formatInZone } from "@/lib/time/zone";
import type { CalendarGroup } from "@/components/events/EventsPageClient";
import type { Event, Rsvp } from "@/lib/types";

interface EventListViewProps {
  groups: CalendarGroup[];
  events: Event[];
  userRsvps: Record<string, Rsvp>;
  userId: string;
  /** The create link for the empty state, when the viewer leads exactly one visible group. */
  createHref: string | null;
  /** The org's zone, resolved by the server; every time here is its wall clock. */
  timeZone: string;
}

export function EventListView({ groups, events, userRsvps, userId, createHref, timeZone }: EventListViewProps) {
  const byId = new Map(groups.map((g) => [g.id, g]));
  const showGroupName = groups.length >= 2;

  if (events.length === 0) {
    return (
      <div className="max-w-5xl rounded-2xl border border-dashed border-border px-6 py-12 text-center">
        <p className="text-xl text-muted-foreground">
          No upcoming calendar items right now. Check back soon!
        </p>
        {createHref && (
          <p className="mt-3">
            <Button
              nativeButton={false}
              render={<Link href={createHref} />}
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Create event
            </Button>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-4 overflow-visible">
      {events.map((event, index) => {
        const group = byId.get(event.group_id);
        const color = group?.color ?? "var(--color-brand-primary)";
        const textColor = group ? groupTextColor(group.color) : "#FFFFFF";
        const month = formatInZone(event.start_time, timeZone, { month: "short" }).toUpperCase();
        const dayNum = formatInZone(event.start_time, timeZone, { day: "numeric" });
        const fullDate = formatEventDate(event.start_time, timeZone);
        const timeRange = formatEventRange(event.start_time, event.end_time, timeZone);

        // A recurring occurrence carries its date so the detail and edit
        // pages know which one is meant.
        const isSeriesOccurrence = !!event.recurrence_frequency && !event.series_id;
        const occurrenceParam = isSeriesOccurrence
          ? `?occurrence=${encodeURIComponent(event.start_time)}`
          : "";
        const viewHref = groupPath(event.group_id, `/calendar/${event.id}${occurrenceParam}`);
        const editHref = groupPath(event.group_id, `/calendar/${event.id}/edit${occurrenceParam}`);

        return (
          <div
            key={`${event.id}-${index}`}
            className="relative overflow-visible rounded-2xl border border-border bg-white px-4 py-4 shadow-sm transition-all hover:border-brand-primary/30 hover:shadow-md"
          >
            <div
              className="absolute inset-x-0 top-0 h-1 rounded-t-2xl"
              style={{ backgroundColor: color }}
            />

            <div className="flex flex-col gap-4 md:flex-row md:items-start">
              <div
                className="shrink-0 flex h-16 w-16 flex-col items-center justify-center rounded-2xl shadow-sm"
                style={{ background: color, color: textColor }}
              >
                <span className="text-base font-bold tracking-widest leading-none">{month}</span>
                <span className="text-2xl font-bold font-display leading-tight">{dayNum}</span>
              </div>

              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={viewHref}
                        className="font-display text-xl font-bold leading-tight text-slate-800 hover:text-brand-primary-text"
                      >
                        {event.title}
                      </Link>
                      {showGroupName && group && (
                        <Badge
                          variant="secondary"
                          className="bg-brand-bg-light text-brand-primary-text border-brand-primary/20 text-base"
                        >
                          {group.name}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-base text-slate-600">
                      <div className="flex items-center gap-2">
                        <CalendarDays className="h-4 w-4 shrink-0 text-brand-primary-light" />
                        <span>{fullDate}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 shrink-0 text-brand-primary-light" />
                        <span>{timeRange}</span>
                      </div>
                      {event.location && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex min-w-0 items-center gap-2 hover:text-brand-primary-text"
                        >
                          <MapPin className="h-4 w-4 shrink-0 text-brand-primary-light" />
                          <span className="truncate">{event.location}</span>
                        </a>
                      )}
                    </div>
                  </div>

                  {/* shrink-0 prevents this group from compressing and wrapping "Add to Calendar" */}
                  <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
                    <Button
                      variant="outline"
                      size="sm"
                      nativeButton={false}
                      render={<Link href={viewHref} />}
                    >
                      View
                    </Button>
                    {group?.isLeader && (
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={<Link href={editHref} />}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        Edit
                      </Button>
                    )}
                    <div className="relative z-10 overflow-visible">
                      <AddToCalendarButton
                        instance={`event-list-${event.id}-${index}`}
                        eventTitle={event.title}
                        startTime={event.start_time}
                        endTime={event.end_time}
                        location={event.location}
                        description={event.description}
                        timeZone={timeZone}
                        compact
                      />
                    </div>
                  </div>
                </div>

                {event.description && (
                  <p className="max-w-3xl text-base leading-relaxed text-slate-600 line-clamp-2">
                    {event.description}
                  </p>
                )}

                {event.is_rsvp_enabled && (
                  <div className="border-t border-slate-100 pt-3">
                    <RsvpButton
                      eventId={event.id}
                      userId={userId}
                      currentStatus={userRsvps[event.id]?.status ?? null}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
