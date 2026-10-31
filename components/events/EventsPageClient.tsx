"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Rss, ChevronDown, Plus } from "lucide-react";
import { CalendarViewSwitch } from "@/components/events/CalendarToolbar";
import { EventCalendarView } from "@/components/events/EventCalendarView";
import { EventListView } from "@/components/events/EventListView";
import { EventWeekView } from "@/components/events/EventWeekView";
import {
  calendarViewReducer,
  initialCalendarViewState,
  shownView,
} from "@/components/events/calendarViewState";
import { useIsPhone } from "@/components/events/useIsPhone";
import { PageHeader } from "@/components/layout/PageHeader";
import { groupPath } from "@/lib/groups/active";
import { failureMessage } from "@/lib/errorCopy";
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
  const [viewState, dispatch] = useReducer(
    calendarViewReducer,
    groups.map((g) => g.id),
    initialCalendarViewState
  );
  const { visibleGroupIds } = viewState;
  const isPhone = useIsPhone();
  const view = shownView(viewState, isPhone);
  const [switchUsed, setSwitchUsed] = useState(false);
  const viewSwitch = (
    <CalendarViewSwitch
      view={view}
      focusOnMount={switchUsed}
      onChange={(next) => {
        setSwitchUsed(true);
        dispatch({ type: "setView", view: next });
      }}
    />
  );

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
        toast.error(failureMessage("create your calendar link", res.status));
        return null;
      }
      const { token } = (await res.json()) as { token: string };
      setMintedToken(token);
      return token;
    } catch {
      toast.error(failureMessage("create your calendar link", "network"));
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
    () => expandUpcomingEvents(allEvents.filter((e) => visibleGroupIds.has(e.group_id)), timeZone),
    [allEvents, visibleGroupIds, timeZone]
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

  const subscribeMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger render={
        <Button variant="outline">
          <Rss aria-hidden="true" />
          Subscribe
          <ChevronDown aria-hidden="true" />
        </Button>
      } />
      <DropdownMenuContent align="end" className="w-72 rounded-2xl">
        <DropdownMenuLabel className="text-base font-normal text-muted-foreground">
          A new link replaces your earlier one, and the earlier link stops working.
        </DropdownMenuLabel>
        {groups.length >= 2 && (
          <DropdownMenuItem className="min-h-11 text-base" onClick={() => openCalendarFeed()}>
            All my groups
          </DropdownMenuItem>
        )}
        {groups.map((group) => (
          <DropdownMenuItem
            key={group.id}
            className="min-h-11 gap-2 text-base"
            onClick={() => openCalendarFeed(group.id)}
          >
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: group.color }}
            />
            {group.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const addEventAction =
    ledVisible.length === 1 ? (
      <Button nativeButton={false} render={<Link href={newEventHref(ledVisible[0].id)} />}>
        <Plus aria-hidden="true" />
        Add event
      </Button>
    ) : ledVisible.length > 1 ? (
      <DropdownMenu>
        <DropdownMenuTrigger render={
          <Button>
            <Plus aria-hidden="true" />
            Add event
            <ChevronDown aria-hidden="true" />
          </Button>
        } />
        <DropdownMenuContent align="end" className="w-60 rounded-2xl">
          <DropdownMenuLabel className="text-base">Add to</DropdownMenuLabel>
          {ledVisible.map((group) => (
            <DropdownMenuItem
              key={group.id}
              className="min-h-11 gap-2 text-base"
              nativeButton={false}
              render={<Link href={newEventHref(group.id)} />}
            >
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: group.color }}
              />
              {group.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null;

  return (
    <div>
      <PageHeader
        title="Calendar"
        actions={
          <>
            {subscribeMenu}
            {addEventAction}
          </>
        }
      />

      {groups.length >= 2 && (
        <div role="group" className="mb-4 flex flex-wrap items-center gap-2" aria-label="Showing">
          <span className="mr-1 text-base font-semibold text-muted-foreground">Showing</span>
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
                    ? "border-border bg-card text-foreground hover:bg-muted"
                    : "border-dashed border-border bg-transparent text-muted-foreground line-through hover:bg-muted"
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
              className="inline-flex min-h-11 items-center rounded-full px-4 text-base font-semibold text-brand-primary-text hover:underline"
            >
              Show all
            </button>
          )}
        </div>
      )}

      {view === "month" && (
        <EventCalendarView
          groups={groups}
          events={allEvents}
          visibleGroupIds={visibleGroupIds}
          onDateClick={onDateClick}
          timeZone={timeZone}
          viewSwitch={viewSwitch}
          compact={isPhone}
        />
      )}
      {view === "week" && (
        <EventWeekView
          groups={groups}
          events={allEvents}
          visibleGroupIds={visibleGroupIds}
          timeZone={timeZone}
          viewSwitch={viewSwitch}
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
          viewSwitch={viewSwitch}
        />
      )}
    </div>
  );
}
