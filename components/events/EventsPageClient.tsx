"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Rss, ChevronDown, SlidersHorizontal } from "lucide-react";
import { EventCalendarView } from "@/components/events/EventCalendarView";
import { EventListView } from "@/components/events/EventListView";
import { PageHeader } from "@/components/layout/PageHeader";
import { expandUpcomingEvents } from "@/lib/recurrence";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import type { Event, EventCalendar, Rsvp } from "@/lib/types";

type View = "calendar" | "list";

const outlineButtonClass =
  "h-12 rounded-xl border-slate-200 bg-white px-4 text-base font-medium text-slate-600 shadow-sm hover:border-brand-primary/30 hover:bg-white hover:text-brand-primary";

interface EventsPageClientProps {
  /** The group whose event pages the rows link to. */
  groupId: string;
  allEvents: (Event & { calendar?: EventCalendar | null })[];
  calendars: EventCalendar[];
  userRsvps: Record<string, Rsvp>;
  userId: string | null;
  isMember: boolean;
  isAdmin: boolean;
}

export function EventsPageClient({
  groupId,
  allEvents,
  calendars,
  userRsvps,
  userId,
  isMember,
  isAdmin,
}: EventsPageClientProps) {
  const [view, setView] = useState<View>("calendar");

  // webcal:// feed links need an absolute host, but this component still SSRs,
  // where `window` is undefined. Resolve the host on the client after mount.
  const [host, setHost] = useState("");
  useEffect(() => setHost(window.location.host), []);

  // The token is hashed at rest and can't be re-read from the server, so it's
  // minted lazily on first use and cached only for this page view. Every menu
  // item reuses the same minted token; a fresh page load mints a new one.
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  async function ensureToken(): Promise<string | null> {
    if (mintedToken) return mintedToken;
    try {
      const res = await fetch("/api/calendar/subscription-token", { method: "POST" });
      if (!res.ok) {
        toast.error("Couldn't create your calendar link. Please try again.");
        return null;
      }
      const { token } = (await res.json()) as { token: string };
      setMintedToken(token);
      return token;
    } catch {
      toast.error("Couldn't create your calendar link. Please try again.");
      return null;
    }
  }

  async function openCalendarFeed(calendarId?: string) {
    const token = await ensureToken();
    if (!token || !host) return;
    const url = `webcal://${host}/api/calendar/feed.ics?token=${token}${
      calendarId ? `&calendar=${calendarId}` : ""
    }`;
    window.location.href = url;
  }

  // For the list view, expand recurring events from the ±1-year window and
  // filter to upcoming occurrences (so "never-ending" series show future dates).
  const expandedUpcomingEvents = useMemo(
    () => expandUpcomingEvents(allEvents),
    [allEvents]
  );

  const hasUncategorized = useMemo(
    () => allEvents.some((event) => event.calendar_id === null),
    [allEvents]
  );
  const [visibleCalendarIds, setVisibleCalendarIds] = useState<Set<string | null>>(
    () => {
      const ids = new Set<string | null>(calendars.map((calendar) => calendar.id));
      if (hasUncategorized) ids.add(null);
      return ids;
    }
  );

  const toggleCalendar = (id: string | null) => {
    setVisibleCalendarIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const totalCalendarOptions = calendars.length + (hasUncategorized ? 1 : 0);
  const selectedCalendarCount =
    visibleCalendarIds.size - (!hasUncategorized && visibleCalendarIds.has(null) ? 1 : 0);
  const calendarFilterSummary =
    totalCalendarOptions === 0 || selectedCalendarCount === totalCalendarOptions
      ? "All calendars"
      : `${selectedCalendarCount} selected`;

  return (
    <div>
      <PageHeader
        title="Calendar"
        actions={
          <>
            {isMember && (
              <DropdownMenu>
                <DropdownMenuTrigger render={
                  <Button
                    variant="outline"
                    className="h-12 gap-2 rounded-xl border-slate-200 bg-white px-5 text-base font-medium text-slate-600 shadow-sm hover:border-brand-primary/30 hover:bg-white hover:text-brand-primary"
                  >
                    <Rss className="h-4 w-4" />
                    Subscribe to Calendar
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                } />
                <DropdownMenuContent align="end" className="w-56 rounded-2xl">
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    Getting a link below replaces any earlier one — older
                    calendar links stop working.
                  </DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => openCalendarFeed()}>
                    All Calendars
                  </DropdownMenuItem>
                  {calendars.map((cal) => (
                    <DropdownMenuItem
                      key={cal.id}
                      className="gap-2"
                      onClick={() => openCalendarFeed(cal.id)}
                    >
                      <span
                        className="inline-block h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: cal.color ?? "var(--color-brand-primary)" }}
                      />
                      {cal.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      {isAdmin && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Button
            variant="outline"
            className={outlineButtonClass}
            nativeButton={false}
            render={<Link href="/admin/events/new" />}
          >
            Add Event
          </Button>
          <Button
            variant="outline"
            className={outlineButtonClass}
            nativeButton={false}
            render={<Link href="/admin/calendars" />}
          >
            Add Calendar
          </Button>
        </div>
      )}

      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="inline-flex w-fit items-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          <Button
            onClick={() => setView("calendar")}
            variant="ghost"
            className={`h-12 rounded-lg px-5 text-base font-semibold ${
              view === "calendar"
                ? "bg-brand-primary text-white shadow-sm hover:bg-brand-primary/90 hover:text-white"
                : "text-slate-600 hover:bg-slate-50 hover:text-brand-primary"
            }`}
          >
            Calendar
          </Button>
          <Button
            onClick={() => setView("list")}
            variant="ghost"
            className={`h-12 rounded-lg px-5 text-base font-semibold ${
              view === "list"
                ? "bg-brand-primary text-white shadow-sm hover:bg-brand-primary/90 hover:text-white"
                : "text-slate-600 hover:bg-slate-50 hover:text-brand-primary"
            }`}
          >
            List
          </Button>
        </div>

        {view === "calendar" && (calendars.length > 0 || hasUncategorized) && (
          <div className="flex flex-col gap-2 md:items-end">
            <span className="text-base font-semibold uppercase tracking-[0.18em] text-slate-600">
              Calendars
            </span>
            <DropdownMenu>
              <DropdownMenuTrigger render={
                <Button
                  variant="outline"
                  className="h-12 min-w-52 justify-between gap-3 rounded-xl border-slate-200 bg-white px-4 text-base font-medium text-slate-600 shadow-sm hover:border-brand-primary/30 hover:bg-white hover:text-brand-primary"
                >
                  <span className="flex items-center gap-2">
                    <SlidersHorizontal className="h-4 w-4" />
                    {calendarFilterSummary}
                  </span>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              } />
              <DropdownMenuContent align="end" className="w-64 rounded-2xl">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Visible Calendars</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {calendars.map((cal) => (
                    <DropdownMenuCheckboxItem
                      key={cal.id}
                      checked={visibleCalendarIds.has(cal.id)}
                      onCheckedChange={() => toggleCalendar(cal.id)}
                      className="gap-2"
                    >
                      <span
                        className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: cal.color ?? "var(--color-brand-primary)" }}
                      />
                      {cal.name}
                    </DropdownMenuCheckboxItem>
                  ))}
                  {hasUncategorized && (
                    <DropdownMenuCheckboxItem
                      checked={visibleCalendarIds.has(null)}
                      onCheckedChange={() => toggleCalendar(null)}
                      className="gap-2"
                    >
                      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-slate-400" />
                      Other
                    </DropdownMenuCheckboxItem>
                  )}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {view === "calendar" ? (
        <EventCalendarView
          groupId={groupId}
          events={allEvents}
          visibleCalendarIds={visibleCalendarIds}
          isAdmin={isAdmin}
        />
      ) : (
        <EventListView
          groupId={groupId}
          events={expandedUpcomingEvents}
          userRsvps={userRsvps}
          userId={userId}
          isMember={isMember}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}
