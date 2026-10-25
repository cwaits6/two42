"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Rss, ChevronDown, Plus } from "lucide-react";
import { EventCalendarView } from "@/components/events/EventCalendarView";
import { EventListView } from "@/components/events/EventListView";
import { EventWeekView } from "@/components/events/EventWeekView";
import {
  CALENDAR_VIEWS,
  calendarViewReducer,
  initialCalendarViewState,
  type CalendarView,
} from "@/components/events/calendarViewState";
import { PageHeader } from "@/components/layout/PageHeader";
import { groupPath } from "@/lib/groups/active";
import { expandUpcomingEvents } from "@/lib/recurrence";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import type { Event, Rsvp } from "@/lib/types";

export type CalendarGroup = {
  id: string;
  name: string;
  color: string;
  isLeader: boolean;
};

const outlineButtonClass =
  "h-12 gap-2 rounded-xl border-slate-200 bg-white px-5 text-base font-medium text-slate-600 shadow-sm hover:border-brand-primary/30 hover:bg-white hover:text-brand-primary";

interface EventsPageClientProps {
  /** The groups this page spans, in membership order. */
  groups: CalendarGroup[];
  allEvents: Event[];
  userRsvps: Record<string, Rsvp>;
  userId: string;
  /** The org's zone, resolved by the server; every view formats in it. */
  timeZone: string;
}

export function EventsPageClient({ groups, allEvents, userRsvps, userId, timeZone }: EventsPageClientProps) {
  const router = useRouter();
  const [{ view, visibleGroupIds }, dispatch] = useReducer(
    calendarViewReducer,
    groups.map((g) => g.id),
    initialCalendarViewState
  );
  const setView = (next: CalendarView) => dispatch({ type: "setView", view: next });

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

  async function openCalendarFeed(groupId?: string) {
    const token = await ensureToken();
    if (!token || !host) return;
    window.location.href = `webcal://${host}/api/calendar/feed.ics?token=${token}${
      groupId ? `&group=${groupId}` : ""
    }`;
  }

  const toggleGroup = (id: string) => dispatch({ type: "toggleGroup", id });
  const showAll = () => dispatch({ type: "showAll" });
  const anyHidden = visibleGroupIds.size < groups.length;

  // For the list view, expand recurring events from the ±1-year window and
  // keep upcoming occurrences of the visible groups.
  const upcomingVisible = useMemo(
    () => expandUpcomingEvents(allEvents.filter((e) => visibleGroupIds.has(e.group_id))),
    [allEvents, visibleGroupIds]
  );

  // Add event targets a group the viewer leads. One such visible group is a
  // direct link; several are a choice.
  const ledVisible = groups.filter((g) => g.isLeader && visibleGroupIds.has(g.id));
  const newEventHref = (groupId: string, date?: string) =>
    groupPath(groupId, `/calendar/new${date ? `?date=${date}` : ""}`);
  const onDateClick =
    ledVisible.length === 1
      ? (date: string) => router.push(newEventHref(ledVisible[0].id, date))
      : undefined;

  // Arrow keys move the checked view and its focus, the radiogroup contract.
  const onViewKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const index = CALENDAR_VIEWS.findIndex((v) => v.value === view);
    const next = CALENDAR_VIEWS[(index + step + CALENDAR_VIEWS.length) % CALENDAR_VIEWS.length];
    setView(next.value);
    const radios = e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]');
    radios[CALENDAR_VIEWS.indexOf(next)]?.focus();
  };

  return (
    <div>
      <PageHeader
        title="Calendar"
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger render={
              <Button variant="outline" className={outlineButtonClass}>
                <Rss className="h-4 w-4" />
                Subscribe
                <ChevronDown className="h-4 w-4" />
              </Button>
            } />
            <DropdownMenuContent align="end" className="w-64 rounded-2xl">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                Getting a link below replaces any earlier one — older calendar
                links stop working.
              </DropdownMenuLabel>
              <DropdownMenuItem onClick={() => openCalendarFeed()}>
                All my calendars
              </DropdownMenuItem>
              {groups.map((group) => (
                <DropdownMenuItem
                  key={group.id}
                  className="gap-2"
                  onClick={() => openCalendarFeed(group.id)}
                >
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: group.color }}
                  />
                  {group.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div
          role="radiogroup"
          aria-label="View"
          onKeyDown={onViewKeyDown}
          className="inline-flex w-fit items-center rounded-xl border border-slate-200 bg-white p-1 shadow-sm"
        >
          {CALENDAR_VIEWS.map((option) => {
            const checked = view === option.value;
            return (
              <Button
                key={option.value}
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                onClick={() => setView(option.value)}
                variant="ghost"
                className={`h-12 rounded-lg px-5 text-base font-semibold ${
                  checked
                    ? "bg-brand-primary text-white shadow-sm hover:bg-brand-primary/90 hover:text-white"
                    : "text-slate-600 hover:bg-slate-50 hover:text-brand-primary"
                }`}
              >
                {option.label}
              </Button>
            );
          })}
        </div>

        {ledVisible.length === 1 && (
          <Button
            variant="outline"
            className={outlineButtonClass}
            nativeButton={false}
            render={<Link href={newEventHref(ledVisible[0].id)} />}
          >
            <Plus className="h-4 w-4" />
            Add event
          </Button>
        )}
        {ledVisible.length > 1 && (
          <DropdownMenu>
            <DropdownMenuTrigger render={
              <Button variant="outline" className={outlineButtonClass}>
                <Plus className="h-4 w-4" />
                Add event
                <ChevronDown className="h-4 w-4" />
              </Button>
            } />
            <DropdownMenuContent align="end" className="w-56 rounded-2xl">
              <DropdownMenuLabel>Add to</DropdownMenuLabel>
              {ledVisible.map((group) => (
                <DropdownMenuItem
                  key={group.id}
                  className="gap-2"
                  nativeButton={false}
                  render={<Link href={newEventHref(group.id)} />}
                >
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: group.color }}
                  />
                  {group.name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {view === "month" && (
        <EventCalendarView
          groups={groups}
          events={allEvents}
          visibleGroupIds={visibleGroupIds}
          onDateClick={onDateClick}
          timeZone={timeZone}
        />
      )}
      {view === "week" && (
        <EventWeekView
          groups={groups}
          events={allEvents}
          visibleGroupIds={visibleGroupIds}
          timeZone={timeZone}
        />
      )}
      {view === "list" && (
        <EventListView
          groups={groups}
          events={upcomingVisible}
          userRsvps={userRsvps}
          userId={userId}
          createHref={ledVisible.length === 1 ? newEventHref(ledVisible[0].id) : null}
          timeZone={timeZone}
        />
      )}

      {groups.length >= 2 && (
        <div className="mt-4 flex flex-wrap items-center gap-2" aria-label="Showing">
          <span className="mr-1 text-base font-semibold uppercase tracking-[0.18em] text-slate-600">
            Showing
          </span>
          {groups.map((group) => {
            const visible = visibleGroupIds.has(group.id);
            return (
              <button
                key={group.id}
                type="button"
                aria-pressed={visible}
                onClick={() => toggleGroup(group.id)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-base font-medium transition-colors ${
                  visible
                    ? "border-slate-200 bg-white text-slate-800"
                    : "border-dashed border-slate-300 bg-slate-50 text-slate-500 line-through opacity-70"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: group.color }}
                />
                {group.name}
              </button>
            );
          })}
          {anyHidden && (
            <button
              type="button"
              onClick={showAll}
              className="inline-flex min-h-11 items-center rounded-full px-4 text-base font-semibold text-brand-primary hover:underline"
            >
              Show all
            </button>
          )}
        </div>
      )}
    </div>
  );
}
