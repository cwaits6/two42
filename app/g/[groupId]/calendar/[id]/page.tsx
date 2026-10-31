import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { mintSignedUrls } from "@/lib/storageRead";
import { AddToCalendarButton } from "@/components/events/AddToCalendarButton";
import { EventMap } from "@/components/events/EventMap";
import { RsvpControl } from "@/components/events/RsvpControl";
import { SubscribeToEventButton } from "@/components/events/SubscribeToEventButton";
import { AttendeeStrip, type Attendee } from "./_components/AttendeeStrip";
import { JoinMeetingBlock } from "@/components/events/JoinMeetingBlock";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import type { MeetingFields } from "@/lib/meetings";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";
import type { Event, Rsvp } from "@/lib/types";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { dayKey, formatEventTime, formatInZone } from "@/lib/time/zone";
import { pageTitle } from "@/lib/pageTitle";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ groupId: string; id: string }>;
}) {
  const { groupId, id } = await params;
  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select("title")
    .eq("id", id)
    .eq("group_id", groupId)
    .eq("is_cancelled", false)
    .maybeSingle();

  return pageTitle(event?.title ?? "Event", { groupId });
}

// ── MetaCell: a single column in the meta strip ──────────────────────────────
function MetaCell({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string | null;
}) {
  return (
    <div>
      <div className="font-sans text-base uppercase tracking-[1.8px] text-muted-foreground font-semibold">
        {label}
      </div>
      <div className="font-serif text-[22px] font-medium text-foreground mt-1 leading-tight tracking-tight">
        {value}
      </div>
      {sub && (
        <div className="font-sans text-base text-muted-foreground mt-0.5">
          {sub}
        </div>
      )}
    </div>
  );
}

export default async function EventDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string; id: string }>;
  searchParams: Promise<{ occurrence?: string }>;
}) {
  const { groupId, id } = await params;
  const group = await requireActiveGroup(groupId);
  const lecturesHref = groupPath(group.id, "/lectures");
  const { occurrence } = await searchParams;
  const supabase = await createClient();
  const timeZone = await getOrgTimeZone();

  // A cross-group id is not found, never a different status; so is a
  // cancelled date of a repeating event.
  const { data: eventRaw } = await supabase
    .from("events")
    .select("*")
    .eq("id", id)
    .eq("group_id", group.id)
    .eq("is_cancelled", false)
    .maybeSingle();

  if (!eventRaw) notFound();

  const event = eventRaw as Event;

  const user = await getOptionalUser();

  // requireActiveGroup() admitted only an approved member of this group.
  const isLeader = group.role === "leader";

  // Fetch current user's RSVP
  let userRsvp: Rsvp | null = null;
  if (user) {
    const { data } = await supabase
      .from("rsvps")
      .select("*")
      .eq("event_id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    userRsvp = data;
  }

  // Fetch attendees (yes + maybe) joined with profiles — only when RSVP is enabled
  let attendees: Attendee[] = [];
  if (event.is_rsvp_enabled) {
    const { data: rsvpsRaw } = await supabase
      .from("rsvps")
      .select("user_id, status, profiles(id, first_name, last_name, preferred_name, avatar_url)")
      .eq("event_id", id)
      .in("status", ["yes", "maybe"]);

    attendees = (rsvpsRaw ?? []).map((r) => {
      const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
      return {
        id: p?.id ?? r.user_id,
        first_name: p?.first_name ?? null,
        last_name: p?.last_name ?? null,
        preferred_name: p?.preferred_name ?? null,
        avatar_url: p?.avatar_url ?? null,
        status: r.status as Attendee["status"],
      };
    });

    // Private buckets: exchange stored avatar URLs for signed URLs
    // before they reach AttendeeStrip's renders.
    const signedAvatars = await mintSignedUrls(attendees.map((a) => a.avatar_url));
    attendees = attendees.map((a, i) => ({ ...a, avatar_url: signedAvatars[i] }));
  }

  // Formatting helpers.
  // When viewing a specific occurrence of a recurring series, shift the displayed
  // start/end times to that occurrence's date while preserving the event duration.
  let displayStartTime = event.start_time;
  let displayEndTime = event.end_time;

  if (occurrence && event.recurrence_frequency && !event.series_id) {
    try {
      const occurrenceISO = decodeURIComponent(occurrence);
      const parsedOccurrence = new Date(occurrenceISO);
      if (!isNaN(parsedOccurrence.getTime())) {
        displayStartTime = occurrenceISO;
        if (event.end_time) {
          const duration =
            new Date(event.end_time).getTime() - new Date(event.start_time).getTime();
          displayEndTime = new Date(parsedOccurrence.getTime() + duration).toISOString();
        }
      }
    } catch {
      // malformed percent-encoding — fall back to base event times
    }
  }

  // Meeting fields live on the series anchor; exception rows inherit them.
  let meeting: MeetingFields | null = null;
  let meetingSource: MeetingFields = event;
  if (event.series_id) {
    const { data: anchor } = await supabase
      .from("events")
      .select(
        "meeting_url, meeting_id, meeting_passcode, meeting_show_on_dashboard, meeting_lead_minutes"
      )
      .eq("id", event.series_id)
      .eq("group_id", group.id)
      .maybeSingle();
    if (anchor) meetingSource = anchor;
  }
  if (meetingSource.meeting_url) meeting = meetingSource;

  // Recordings link for the ended state — only when there's a library to point to
  let hasLectures = false;
  if (meeting) {
    const { count } = await supabase
      .from("lectures")
      .select("id", { count: "exact", head: true })
      .eq("group_id", group.id);
    hasLectures = (count ?? 0) > 0;
  }

  // Short date for meta strip
  const shortDate = formatInZone(displayStartTime, timeZone, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const shortYear = formatInZone(displayStartTime, timeZone, { year: "numeric" });
  const startLabel = formatEventTime(displayStartTime, timeZone);
  const endLabel = displayEndTime ? formatEventTime(displayEndTime, timeZone) : null;

  // Build the edit URL — include the occurrence param for recurring series so the
  // edit page knows which occurrence is being modified.
  const editHref = groupPath(
    group.id,
    occurrence && event.recurrence_frequency && !event.series_id
      ? `/calendar/${id}/edit?occurrence=${encodeURIComponent(occurrence)}`
      : `/calendar/${id}/edit`
  );

  // Upcoming pill: whole calendar days until the event, by the org's calendar.
  const diffMs =
    Date.parse(dayKey(displayStartTime, timeZone)) - Date.parse(dayKey(new Date().toISOString(), timeZone));
  const diffDays = Math.round(diffMs / 86400000);
  let upcomingLabel: string | null = null;
  if (diffDays === 0) upcomingLabel = "Today";
  else if (diffDays === 1) upcomingLabel = "Tomorrow";
  else if (diffDays > 1 && diffDays <= 7) upcomingLabel = `In ${diffDays} days`;

  const recordingsHref = hasLectures ? lecturesHref : null;
  const joinBlock = meeting?.meeting_url && (
    <JoinMeetingBlock
      meetingUrl={meeting.meeting_url}
      meetingId={meeting.meeting_id}
      passcode={meeting.meeting_passcode}
      startTime={displayStartTime}
      endTime={displayEndTime}
      leadMinutes={meeting.meeting_lead_minutes}
      timeZone={timeZone}
      recordingsHref={recordingsHref}
    />
  );
  const showRsvp = event.is_rsvp_enabled && !!user;

  return (
    <PageContainer size="wide">
      <PageHeader
        title={event.title}
        subtitle={group.name}
        backHref={groupPath(group.id, "/calendar")}
        backLabel="Back to Calendar"
        actions={
          isLeader && (
            <Button variant="outline" nativeButton={false} render={<Link href={editHref} />}>
              <Pencil aria-hidden="true" />
              Edit event
            </Button>
          )
        }
      />

      <div className="grid grid-cols-1 items-start gap-10 md:grid-cols-[1.5fr_1fr] md:gap-12">
        <div>
          {upcomingLabel && (
            <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-brand-bg-light px-3 py-1.5">
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-accent" />
              <span className="font-sans text-base font-bold uppercase tracking-[1.5px] text-brand-accent-text">
                {diffDays <= 1 ? upcomingLabel : `This week · ${upcomingLabel.toLowerCase()}`}
              </span>
            </div>
          )}

          <div
            className={`grid grid-cols-1 gap-6 border-t border-b border-border py-5 sm:grid-cols-2 ${
              event.location ? "lg:grid-cols-3" : ""
            }`}
          >
            <MetaCell label="Date" value={shortDate} sub={shortYear} />
            <MetaCell label="Time" value={startLabel} sub={endLabel ? `Until ${endLabel}` : null} />
            {event.location && <MetaCell label="Where" value={event.location} sub={null} />}
          </div>

          {event.description && (
            <div className="mt-8">
              <div className="mb-4 flex items-center gap-3">
                <div aria-hidden="true" className="h-px w-6 bg-brand-accent" />
                <h2 className="font-sans text-base font-bold uppercase tracking-[2px] text-brand-accent-text">
                  About this event
                </h2>
              </div>
              <p className="max-w-[620px] whitespace-pre-line font-serif text-[22px] font-normal leading-[1.5] tracking-tight text-foreground">
                {event.description}
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4 md:sticky md:top-6">
          {(showRsvp || joinBlock) && (
            <div className="rounded-2xl bg-primary p-6 text-primary-foreground shadow-lg">
              {showRsvp && (
                <>
                  <h2 className="mb-4 font-serif text-2xl font-medium leading-snug">Are you going?</h2>
                  <RsvpControl
                    eventId={event.id}
                    userId={user.id}
                    currentStatus={userRsvp?.status ?? null}
                    tone="primary"
                  />
                </>
              )}
              {joinBlock && <div className={showRsvp ? "mt-4" : ""}>{joinBlock}</div>}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <AddToCalendarButton
              instance={`event-detail-${event.id}`}
              eventTitle={event.title}
              startTime={displayStartTime}
              endTime={displayEndTime}
              location={event.location}
              description={event.description}
              timeZone={timeZone}
            />
            <SubscribeToEventButton eventId={event.id} />
          </div>

          {event.is_rsvp_enabled && attendees.length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-6">
              <AttendeeStrip attendees={attendees} />
            </div>
          )}

          {event.location && <EventMap location={event.location} />}
        </div>
      </div>
    </PageContainer>
  );
}
