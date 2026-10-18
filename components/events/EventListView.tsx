import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AddToCalendarButton } from "@/components/events/AddToCalendarButton";
import { RsvpButton } from "@/components/events/RsvpButton";
import { CalendarDays, Clock, MapPin, Pencil, Plus } from "lucide-react";
import { groupPath } from "@/lib/groups/active";
import type { Event, EventCalendar, Rsvp } from "@/lib/types";

interface EventListViewProps {
  groupId: string;
  events: (Event & { calendar?: EventCalendar | null })[];
  userRsvps: Record<string, Rsvp>;
  userId: string | null;
  isMember: boolean;
  isAdmin: boolean;
}

export function EventListView({
  groupId,
  events,
  userRsvps,
  userId,
  isMember,
  isAdmin,
}: EventListViewProps) {
  if (events.length === 0) {
    return (
      <div className="max-w-5xl rounded-2xl border border-dashed border-border px-6 py-12 text-center">
        <p className="text-xl text-muted-foreground">
          No upcoming calendar items right now. Check back soon!
        </p>
        {isAdmin && (
          <p className="mt-3">
            <Button
              nativeButton={false}
              render={<Link href="/admin/events/new" />}
              className="bg-brand-primary hover:bg-brand-primary/90 text-white"
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
        const startDate = new Date(event.start_time);
        const endDate = event.end_time ? new Date(event.end_time) : null;
        const month = startDate.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
        const dayNum = startDate.toLocaleDateString("en-US", { day: "numeric" });
        const fullDate = startDate.toLocaleDateString("en-US", {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric",
        });
        const formatTime = (date: Date) =>
          date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

        // For recurring series occurrences (not exceptions), pass the occurrence
        // date so the detail/edit pages know which specific occurrence is shown.
        const isSeriesOccurrence = !!event.recurrence_frequency && !event.series_id;
        const occurrenceParam = isSeriesOccurrence
          ? `?occurrence=${encodeURIComponent(event.start_time)}`
          : "";
        const viewHref = groupPath(groupId, `/calendar/${event.id}${occurrenceParam}`);
        const editHref = `/admin/events/${event.id}/edit${occurrenceParam}`;

        return (
          <div
            key={`${event.id}-${index}`}
            className="relative overflow-visible rounded-2xl border border-border bg-white px-4 py-4 shadow-sm transition-all hover:border-brand-primary/30 hover:shadow-md"
          >
            <div
              className="absolute inset-x-0 top-0 h-1 rounded-t-2xl"
              style={{ backgroundColor: event.calendar?.color ?? "var(--color-brand-primary)" }}
            />

            <div className="flex flex-col gap-4 md:flex-row md:items-start">
              <div
                className="shrink-0 flex h-16 w-16 flex-col items-center justify-center rounded-2xl text-white shadow-sm"
                style={{ background: event.calendar?.color ?? "var(--color-brand-primary)" }}
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
                        className="font-display text-xl font-bold leading-tight text-slate-800 hover:text-brand-primary"
                      >
                        {event.title}
                      </Link>
                      {event.calendar && (
                        <Badge
                          variant="secondary"
                          className="bg-brand-bg-light text-brand-primary border-brand-primary/20 text-base"
                        >
                          {event.calendar.name}
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
                        <span>
                          {formatTime(startDate)}
                          {endDate && <span className="text-slate-400"> – {formatTime(endDate)}</span>}
                        </span>
                      </div>
                      {event.location && (
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex min-w-0 items-center gap-2 hover:text-brand-primary"
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
                    {isAdmin && (
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

                {childrenPlaceholder(event, isMember, userId, userRsvps)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function childrenPlaceholder(
  event: Event,
  isMember: boolean,
  userId: string | null,
  userRsvps: Record<string, Rsvp>
) {
  if (!(isMember && userId && event.is_rsvp_enabled)) return null;

  return (
    <div className="border-t border-slate-100 pt-3">
      <RsvpButton
        eventId={event.id}
        userId={userId}
        currentStatus={userRsvps[event.id]?.status ?? null}
      />
    </div>
  );
}
