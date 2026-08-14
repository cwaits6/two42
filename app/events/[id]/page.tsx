import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { mintSignedUrls } from "@/lib/storageRead";
import { EventRsvpPanel } from "./_components/EventRsvpPanel";
import { AddToCalendarButton } from "@/components/events/AddToCalendarButton";
import { SubscribeToEventButton } from "@/components/events/SubscribeToEventButton";
import { AttendeeStrip, type Attendee } from "./_components/AttendeeStrip";
import { JoinMeetingBlock } from "@/components/events/JoinMeetingBlock";
import type { MeetingFields } from "@/lib/meetings";
import { Button } from "@/components/ui/button";
import { Pencil } from "lucide-react";
import { siteConfig } from "@/lib/config";
import type { Event, EventCalendar, Rsvp } from "@/lib/types";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: event } = await supabase
    .from("events")
    .select("title")
    .eq("id", id)
    .single();

  if (!event) {
    return { title: `Event | ${siteConfig.name}` };
  }

  return { title: `${event.title} | ${siteConfig.name}` };
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
  params: Promise<{ id: string }>;
  searchParams: Promise<{ occurrence?: string }>;
}) {
  const { id } = await params;
  const { occurrence } = await searchParams;
  const supabase = await createClient();

  // Fetch event with calendar join
  const { data: eventRaw } = await supabase
    .from("events")
    .select("*, calendar:event_calendars(*)")
    .eq("id", id)
    .single();

  if (!eventRaw) notFound();

  const event = eventRaw as Event & { calendar?: EventCalendar | null };

  // Auth
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile = null;
  if (user) {
    const { data } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    profile = data;
  }

  const isAdmin = profile?.role === "admin";
  const isMember =
    profile?.role === "member" ||
    profile?.role === "content_editor" ||
    isAdmin;

  // Fetch current user's RSVP
  let userRsvp: Rsvp | null = null;
  if (user && isMember) {
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
      .select("user_id, status, profiles(id, first_name, last_name, avatar_url)")
      .eq("event_id", id)
      .in("status", ["yes", "maybe"]);

    attendees = (rsvpsRaw ?? []).map((r) => {
      const p = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
      return {
        id: p?.id ?? r.user_id,
        first_name: p?.first_name ?? null,
        last_name: p?.last_name ?? null,
        avatar_url: p?.avatar_url ?? null,
        status: r.status as Attendee["status"],
      };
    });

    // Private buckets (CWA-59): exchange stored avatar URLs for signed URLs
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
  if (isMember) {
    let source: MeetingFields = event;
    if (event.series_id) {
      const { data: anchor } = await supabase
        .from("events")
        .select(
          "meeting_url, meeting_id, meeting_passcode, meeting_show_on_dashboard, meeting_lead_minutes"
        )
        .eq("id", event.series_id)
        .maybeSingle();
      if (anchor) source = anchor;
    }
    if (source.meeting_url) meeting = source;
  }

  // Recordings link for the ended state — only when there's a library to point to
  let hasLectures = false;
  if (meeting) {
    const { count } = await supabase
      .from("lectures")
      .select("id", { count: "exact", head: true });
    hasLectures = (count ?? 0) > 0;
  }

  const startDate = new Date(displayStartTime);
  const endDate = displayEndTime ? new Date(displayEndTime) : null;
  const googleMapsApiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  // Short date for meta strip
  const shortDate = startDate.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });

  const shortYear = startDate.toLocaleDateString("en-US", {
    year: "numeric",
    timeZone: "America/New_York",
  });

  const formatTime = (d: Date) =>
    d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/New_York" });

  // Build the edit URL — include the occurrence param for recurring series so the
  // edit page knows which occurrence is being modified.
  const editHref = occurrence && event.recurrence_frequency && !event.series_id
    ? `/admin/events/${id}/edit?occurrence=${encodeURIComponent(occurrence)}`
    : `/admin/events/${id}/edit`;

  // Breadcrumb date label
  const breadcrumbDate = startDate.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });

  // Upcoming pill: compute days until event
  const now = new Date();
  // Compare dates only (strip time) in America/New_York
  const todayNY = new Date(now.toLocaleDateString("en-US", { timeZone: "America/New_York" }));
  const eventNY = new Date(startDate.toLocaleDateString("en-US", { timeZone: "America/New_York" }));
  const diffMs = eventNY.getTime() - todayNY.getTime();
  const diffDays = Math.round(diffMs / 86400000);
  let upcomingLabel: string | null = null;
  if (diffDays === 0) upcomingLabel = "Today";
  else if (diffDays === 1) upcomingLabel = "Tomorrow";
  else if (diffDays > 1 && diffDays <= 7) upcomingLabel = `In ${diffDays} days`;

  // Attendee counts

  return (
    <div className="relative min-h-dvh bg-background">
      <div className="relative container mx-auto px-4 py-8 md:py-12 max-w-6xl">
        {/* ── Breadcrumb ── */}
        <div className="flex items-center justify-between mb-8">
          <nav className="font-sans text-base text-muted-foreground">
            <Link href="/events" className="hover:text-foreground transition-colors">
              Events
            </Link>
            <span className="mx-2 text-muted-foreground/50">›</span>
            <span className="text-foreground font-medium">
              {breadcrumbDate} · {event.title}
            </span>
          </nav>

          {/* Admin edit button — top right, visually subordinate */}
          {isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-muted-foreground hover:border-brand-primary/30 hover:text-brand-primary"
              nativeButton={false}
              render={<Link href={editHref} />}
            >
              <Pencil className="h-3 w-3" />
              Edit
            </Button>
          )}
        </div>

        {/* ── Two-column grid ── */}
        <div className="grid grid-cols-1 md:grid-cols-[1.5fr_1fr] gap-10 md:gap-12 items-start">

          {/* ═══════════════════════════════════════════════
              LEFT COLUMN — hero + meta + description
          ═══════════════════════════════════════════════ */}
          <div>
            {/* Upcoming pill */}
            {upcomingLabel && (
              <div
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-5"
                style={{
                  background:
                    "color-mix(in srgb, var(--color-brand-accent) 13%, transparent)",
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: "var(--color-brand-accent)" }}
                />
                <span
                  className="font-sans text-base font-bold uppercase tracking-[1.5px]"
                  style={{ color: "var(--color-brand-accent)" }}
                >
                  {diffDays <= 1
                    ? upcomingLabel
                    : `This week · ${upcomingLabel.toLowerCase()}`}
                </span>
              </div>
            )}

            {/* Title */}
            <h1 className="font-serif text-5xl md:text-6xl font-medium text-foreground leading-[1.05] tracking-tight">
              {event.title}
            </h1>

            {/* Calendar name as serif-italic subtitle — only if present */}
            {event.calendar?.name && (
              <p
                className="font-serif italic text-[22px] mt-2 leading-snug tracking-tight"
                style={{ color: "var(--color-brand-primary)" }}
              >
                {event.calendar.name}
              </p>
            )}

            {/* Meta strip */}
            <div
              className={`mt-8 py-5 grid grid-cols-1 gap-6 border-t border-b border-border sm:grid-cols-2 ${
                event.location ? "lg:grid-cols-3" : ""
              }`}
            >
              <MetaCell
                label="Date"
                value={shortDate}
                sub={shortYear}
              />
              <MetaCell
                label="Time"
                value={formatTime(startDate)}
                sub={endDate ? `Until ${formatTime(endDate)}` : null}
              />
              {event.location && (
                <MetaCell
                  label="Where"
                  value={event.location}
                  sub={null}
                />
              )}
            </div>

            {/* Description */}
            {event.description && (
              <div className="mt-8">
                {/* Eyebrow */}
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-px w-6 bg-brand-accent" />
                  <span className="font-sans text-base font-bold uppercase tracking-[2px] text-brand-accent">
                    About this event
                  </span>
                </div>
                <p
                  className="font-serif text-[22px] leading-[1.5] text-foreground font-normal tracking-tight max-w-[620px]"
                >
                  {event.description}
                </p>
              </div>
            )}
          </div>

          {/* ═══════════════════════════════════════════════
              RIGHT COLUMN — RSVP card + attendees + map
              (sticky on desktop)
          ═══════════════════════════════════════════════ */}
          <div className="flex flex-col gap-4 md:sticky md:top-6">

            {/* ── RSVP Hero Card ── */}
            {event.is_rsvp_enabled && isMember && user && (
              <div
                className="rounded-[18px] p-6 relative overflow-hidden"
                style={{
                  background: "var(--color-brand-primary)",
                  boxShadow:
                    "0 14px 40px color-mix(in srgb, var(--color-brand-primary) 20%, transparent)",
                }}
              >
                <div className="relative text-white">
                  <EventRsvpPanel
                    eventId={event.id}
                    userId={user.id}
                    initialStatus={userRsvp?.status ?? null}
                  />

                  {/* Join the call — time-aware, set once on the recurring event */}
                  {meeting?.meeting_url && (
                    <div className="mt-4">
                      <JoinMeetingBlock
                        meetingUrl={meeting.meeting_url}
                        meetingId={meeting.meeting_id}
                        passcode={meeting.meeting_passcode}
                        startTime={displayStartTime}
                        endTime={displayEndTime}
                        leadMinutes={meeting.meeting_lead_minutes}
                        recordingsHref={hasLectures ? "/lectures" : null}
                      />
                    </div>
                  )}

                  {/* Calendar actions below RSVP */}
                  <div
                    className="flex flex-wrap gap-2 mt-4 pt-4"
                    style={{ borderTop: "1px solid rgba(255,255,255,0.16)" }}
                  >
                    <AddToCalendarButton
                      instance={`event-detail-${event.id}`}
                      eventTitle={event.title}
                      startTime={displayStartTime}
                      endTime={displayEndTime}
                      location={event.location}
                      description={event.description}
                    />
                    {isMember && <SubscribeToEventButton eventId={event.id} />}
                  </div>
                </div>
              </div>
            )}

            {/* Join card when RSVP is disabled but a meeting is set */}
            {!(event.is_rsvp_enabled && isMember && user) && meeting?.meeting_url && (
              <div
                className="rounded-[18px] p-6 relative overflow-hidden"
                style={{
                  background: "var(--color-brand-primary)",
                  boxShadow:
                    "0 14px 40px color-mix(in srgb, var(--color-brand-primary) 20%, transparent)",
                }}
              >
                <div className="relative">
                  <JoinMeetingBlock
                    meetingUrl={meeting.meeting_url}
                    meetingId={meeting.meeting_id}
                    passcode={meeting.meeting_passcode}
                    startTime={displayStartTime}
                    endTime={displayEndTime}
                    leadMinutes={meeting.meeting_lead_minutes}
                    recordingsHref={hasLectures ? "/lectures" : null}
                  />
                </div>
              </div>
            )}

            {/* Calendar actions for non-RSVP or logged-out state */}
            {!(event.is_rsvp_enabled && isMember && user) && (
              <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4">
                <AddToCalendarButton
                  instance={`event-detail-${event.id}`}
                  eventTitle={event.title}
                  startTime={displayStartTime}
                  endTime={displayEndTime}
                  location={event.location}
                  description={event.description}
                />
                {isMember && <SubscribeToEventButton eventId={event.id} />}
              </div>
            )}

            {/* ── Who's coming card ── */}
            {event.is_rsvp_enabled && attendees.length > 0 && (
              <div className="rounded-[18px] border border-border bg-card p-6">
                <AttendeeStrip attendees={attendees} />
              </div>
            )}

            {/* ── Map card ── */}
            {event.location && (
              <div className="rounded-[18px] border border-border bg-card overflow-hidden">
                {/* Map area */}
                <div className="relative" style={{ aspectRatio: "4/3" }}>
                  {googleMapsApiKey ? (
                    <iframe
                      title={`Map of ${event.location}`}
                      src={`https://www.google.com/maps/embed/v1/place?key=${googleMapsApiKey}&q=${encodeURIComponent(event.location)}`}
                      className="absolute inset-0 w-full h-full border-0"
                      loading="lazy"
                      allowFullScreen
                      referrerPolicy="no-referrer-when-downgrade"
                    />
                  ) : (
                    <div
                      className="absolute inset-0 flex items-center justify-center"
                      style={{
                        background:
                          "linear-gradient(135deg, var(--color-brand-warm) 0%, var(--background) 100%)",
                      }}
                    >
                      <div
                        className="bg-white rounded-[10px] px-4 py-2.5 text-center"
                        style={{ boxShadow: "0 6px 16px rgba(0,0,0,0.10)" }}
                      >
                        <div className="font-sans text-sm font-semibold text-foreground">
                          {event.location}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Address + directions */}
                <div className="flex items-center justify-between px-4 py-3.5">
                  <span className="font-sans text-base text-muted-foreground truncate">
                    {event.location}
                  </span>
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-3 inline-flex min-h-12 shrink-0 items-center whitespace-nowrap font-sans text-base font-semibold text-brand-primary hover:underline"
                  >
                    Directions →
                  </a>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
