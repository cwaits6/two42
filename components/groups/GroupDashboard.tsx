import Link from "next/link";
import { redirect } from "next/navigation";
import { Calendar, ChevronRight, Clock, HeartHandshake, MapPin, Megaphone, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { groupPath, type ActiveGroup } from "@/lib/groups/active";
import { greetingName } from "@/lib/groups/greeting";
import { readList } from "@/lib/supabase/readList";
import { PageContainer } from "@/components/layout/PageContainer";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { buttonVariants } from "@/components/ui/button-variants";
import { HomeGreeting } from "@/components/groups/HomeGreeting";
import { formatServiceDate, todayIn } from "@/lib/serving/dates";
import { RsvpControl } from "@/components/events/RsvpControl";
import { JoinMeetingBlock } from "@/components/events/JoinMeetingBlock";
import { expandUpcomingEvents } from "@/lib/recurrence";
import { meetingEndMs, ENDED_GRACE_MS, hasMeeting, type MeetingFields } from "@/lib/meetings";
import { prayerAuthorLabel } from "@/lib/prayer";
import type { Event, Rsvp } from "@/lib/types";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { formatEventTime, formatInZone, relativeDay } from "@/lib/time/zone";

// ── helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 week ago";
  return `${Math.floor(days / 7)} weeks ago`;
}

// Every time below is the org's wall clock: `timeZone` is the org zone the
// component resolves once per request.

function eventWeekday(startTime: string, timeZone: string): string {
  return formatInZone(startTime, timeZone, { weekday: "long" });
}

function eventMonth(startTime: string, timeZone: string): string {
  return formatInZone(startTime, timeZone, { month: "short" });
}

function excerpt(content: string): string {
  // Plain-text excerpt from content (may be JSON blocks or HTML)
  try {
    const blocks: Array<{ content?: Array<{ text?: string }> }> = JSON.parse(content);
    return blocks
      .flatMap((b) => b.content ?? [])
      .map((c) => c.text ?? "")
      .join(" ")
      .slice(0, 140);
  } catch {
    return content.replace(/<[^>]+>/g, "").slice(0, 140);
  }
}

// ── component ────────────────────────────────────────────────────────────────

/** One group's dashboard: its next meeting, your serving turns, its announcements and prayer. */
export async function GroupDashboard({ group }: { group: ActiveGroup }) {
  const supabase = await createClient();
  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const nowDate = new Date();
  const now = nowDate.toISOString();

  // Next event for the hero. Recurring series are stored as a single anchor
  // row and expanded at render time, so fetch a window that also includes
  // anchors and recently-started occurrences (for the live/ended join states).
  const windowStart = new Date(nowDate.getTime() - 24 * 60 * 60 * 1000);
  const windowStartISO = windowStart.toISOString();

  // Every query below is independent of `nextEvent`; fire them together
  // instead of awaiting one at a time.
  const [
    { data: viewer },
    eventsRead,
    rsvpsRead,
    announcementsRead,
    { count: lectureCount },
    prayersRead,
    servingsRead,
    timeZone,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("preferred_name, first_name")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("events")
      .select("*")
      .eq("group_id", group.id)
      .or(
        `start_time.gte.${windowStartISO},` +
        `and(recurrence_frequency.not.is.null,or(recurrence_until.is.null,recurrence_until.gte.${windowStartISO}))`
      )
      .order("start_time", { ascending: true })
      .limit(500),
    supabase
      .from("rsvps")
      .select("*")
      .eq("user_id", user.id),
    supabase
      .from("announcements")
      .select("*")
      .eq("group_id", group.id)
      .eq("is_published", true)
      .lte("published_at", now)
      .order("published_at", { ascending: false })
      .limit(3),
    supabase
      .from("lectures")
      .select("id", { count: "exact", head: true })
      .eq("group_id", group.id),
    supabase
      .from("prayer_wall")
      .select("id, body, is_anonymous, first_name, last_name, preferred_name, created_at")
      .eq("group_id", group.id)
      .eq("is_answered", false)
      .order("created_at", { ascending: false })
      .limit(3),
    // This member's upcoming turns on the group's teams (both inner joins filter)
    getOrgTimeZone().then((zone) =>
      supabase
        .from("serving_signups")
        .select("id, service_date, team_id, teams!inner(id, name, group_id), serving_signup_attendees!inner(profile_id)")
        .eq("teams.group_id", group.id)
        .eq("serving_signup_attendees.profile_id", user.id)
        .gte("service_date", todayIn(zone))
        .order("service_date", { ascending: true })
        .limit(3),
    ),
    getOrgTimeZone(),
  ]);

  // Each section reports its own failed read; the rest of the page still renders.
  const rawEvents = readList(eventsRead, "dashboard events");
  // The hero's RSVP control needs the viewer's replies, so it fails with them.
  const rsvps = readList(rsvpsRead, "the viewer's RSVPs");
  const announcements = readList(announcementsRead, "dashboard announcements");
  const prayers = readList(prayersRead, "dashboard prayer requests");
  const upcomingServings = readList(servingsRead, "the viewer's serving turns") as Array<{
    id: string;
    service_date: string;
    team_id: string;
    teams: { id: string; name: string } | Array<{ id: string; name: string }> | null;
  }> | null;
  const eventsFailed = rawEvents === null || rsvps === null;

  // Keep the current occurrence on the hero through its live window plus a
  // short grace period (ended state points to the recording), then roll over.
  const occurrences = expandUpcomingEvents((rawEvents ?? []) as Event[], timeZone, windowStart);
  const nextEvent = eventsFailed
    ? null
    : (occurrences.find(
        (e) => meetingEndMs(e.start_time, e.end_time) + ENDED_GRACE_MS > nowDate.getTime()
      ) ?? null);

  const userRsvps: Record<string, Rsvp> = Object.fromEntries(
    (rsvps ?? []).map((r) => [r.event_id, r])
  );

  // Meeting fields live on the series anchor; exception rows inherit them.
  let meeting: MeetingFields | null = null;
  let goingCount = 0;
  let maybeCount = 0;

  // These depend on `nextEvent`. The anchor lookup and the event's RSVP list
  // are mutually independent, so fetch them together.
  if (nextEvent) {
    const [anchor, { data: eventRsvps }] = await Promise.all([
      nextEvent.series_id
        ? supabase
            .from("events")
            .select(
              "meeting_url, meeting_id, meeting_passcode, meeting_show_on_dashboard, meeting_lead_minutes"
            )
            .eq("id", nextEvent.series_id)
            .eq("group_id", group.id)
            .maybeSingle()
            .then(({ data }) => data)
        : Promise.resolve(null),
      supabase
        .from("rsvps")
        .select("status")
        .eq("event_id", nextEvent.id),
    ]);

    let source: MeetingFields = nextEvent;
    if (anchor) source = anchor;
    if (hasMeeting(source) && source.meeting_show_on_dashboard) meeting = source;

    if (eventRsvps) {
      goingCount = eventRsvps.filter((r) => r.status === "yes").length;
      maybeCount = eventRsvps.filter((r) => r.status === "maybe").length;
    }
  }

  const href = (path: string) => groupPath(group.id, path);
  const isLeader = group.role === "leader";

  return (
    <PageContainer>
      <HomeGreeting name={greetingName(viewer)} timeZone={timeZone} />

      <div className="space-y-12">
        {/* ── The next event ───────────────────────────────────────────────── */}
        {eventsFailed ? (
          <ErrorState thing="upcoming events" />
        ) : nextEvent ? (
          <div
            className="rounded-2xl p-6 text-white md:p-7"
            style={{
              background: "var(--color-brand-primary)",
              boxShadow:
                "0 14px 40px color-mix(in srgb, var(--color-brand-primary) 20%, transparent)",
            }}
          >
            <div className="mb-4 flex items-center gap-2.5 font-sans text-base font-semibold">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-accent" />
              Next event · {relativeDay(nextEvent.start_time, timeZone)}
            </div>

            <div className="flex flex-wrap items-start gap-5">
              {/* Date tile: Warm Paper ground, Espresso text */}
              <div
                className="flex h-24 w-24 shrink-0 flex-col items-center justify-center gap-1 rounded-2xl"
                style={{ background: "var(--color-brand-warm)", color: "var(--color-brand-navy)" }}
              >
                <span className="font-sans text-sm font-semibold leading-none text-secondary-foreground">
                  {eventWeekday(nextEvent.start_time, timeZone).slice(0, 3)}
                </span>
                <span className="font-serif text-4xl font-semibold leading-none">
                  {formatInZone(nextEvent.start_time, timeZone, { day: "numeric" })}
                </span>
                <span className="font-sans text-sm font-semibold leading-none text-muted-foreground">
                  {eventMonth(nextEvent.start_time, timeZone)}
                </span>
              </div>

              <div className="min-w-0 flex-1 pt-1">
                <h2 className="font-serif text-3xl font-medium leading-tight tracking-tight">
                  {nextEvent.title}
                </h2>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 font-sans text-lg">
                  <span className="inline-flex items-center gap-2">
                    <Clock className="h-5 w-5" aria-hidden="true" />
                    {formatEventTime(nextEvent.start_time, timeZone)}
                  </span>
                  {nextEvent.location && (
                    <span className="inline-flex items-center gap-2">
                      <MapPin className="h-5 w-5" aria-hidden="true" />
                      {nextEvent.location}
                    </span>
                  )}
                </div>
                {nextEvent.description && (
                  <p className="mt-3 max-w-[52ch] font-sans text-lg leading-normal text-white/90">
                    {nextEvent.description.length > 160
                      ? nextEvent.description.slice(0, 160) + "…"
                      : nextEvent.description}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-white/25 pt-5">
              <div className="flex flex-wrap items-center gap-x-2.5 font-sans text-base">
                <span className="font-semibold">Are you going?</span>
                {(goingCount > 0 || maybeCount > 0) && (
                  <span className="text-white/90">
                    {[
                      goingCount > 0 && `${goingCount} going`,
                      maybeCount > 0 && `${maybeCount} maybe`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </div>
              <RsvpControl
                eventId={nextEvent.id}
                userId={user.id}
                currentStatus={userRsvps[nextEvent.id]?.status ?? null}
                tone="primary"
              />
            </div>

            {/* Join the call — time-aware, set on the recurring event */}
            {meeting && (
              <div className="mt-4">
                <JoinMeetingBlock
                  meetingUrl={meeting.meeting_url}
                  meetingId={meeting.meeting_id}
                  passcode={meeting.meeting_passcode}
                  startTime={nextEvent.start_time}
                  endTime={nextEvent.end_time}
                  leadMinutes={meeting.meeting_lead_minutes}
                  timeZone={timeZone}
                  recordingsHref={lectureCount && lectureCount > 0 ? href("/lectures") : null}
                />
              </div>
            )}
          </div>
        ) : (
          <EmptyState
            icon={Calendar}
            message="No upcoming events."
            action={
              isLeader && (
                <Link href={href("/calendar/new")} className={buttonVariants()}>
                  <Plus aria-hidden="true" />
                  Add event
                </Link>
              )
            }
          />
        )}

        {/* ── Your turn to serve ───────────────────────────────────────────── */}
        {upcomingServings === null ? (
          <section>
            <SectionHeading title="Your turn to serve" />
            <ErrorState thing="your serving turns" />
          </section>
        ) : (
          upcomingServings.length > 0 && (
            <section>
              <SectionHeading title="Your turn to serve" />
              <ul>
                {upcomingServings.map((s) => (
                  <li key={s.id} className="border-t border-border first:border-0">
                    <Link
                      href={href(`/serving/${s.team_id}`)}
                      className="flex min-h-16 items-center justify-between gap-4 py-3 transition-colors hover:text-brand-primary-text"
                    >
                      <div>
                        <div className="font-serif text-xl font-medium text-foreground">
                          {(Array.isArray(s.teams) ? s.teams[0]?.name : s.teams?.name) ?? "Serving team"}
                        </div>
                        <div className="mt-0.5 font-sans text-base text-muted-foreground">
                          {formatServiceDate(s.service_date)}
                        </div>
                      </div>
                      <ChevronRight className="h-6 w-6 shrink-0 text-brand-primary-text" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )
        )}

        {/* ── Announcements + Prayer ───────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1.3fr_1fr] lg:gap-8">
          <section>
            <SectionHeading
              title="Announcements"
              link={{ href: href("/announcements"), label: "All announcements" }}
            />
            {announcements === null ? (
              <ErrorState thing="announcements" />
            ) : announcements.length === 0 ? (
              <EmptyState
                icon={Megaphone}
                message="No announcements yet."
                action={
                  isLeader && (
                    <Link
                      href={href("/settings/announcements/new")}
                      className={buttonVariants()}
                    >
                      <Plus aria-hidden="true" />
                      Add announcement
                    </Link>
                  )
                }
              />
            ) : (
              <ul>
                {announcements.map((a) => {
                  const publishedAt = a.published_at || a.created_at;
                  const text = excerpt(a.content);
                  return (
                    <li key={a.id} className="border-t border-border py-4 first:border-0 first:pt-0">
                      <h3 className="font-serif text-xl font-medium leading-snug tracking-tight">
                        <Link
                          href={href(`/announcements#${a.id}`)}
                          className="inline-flex min-h-11 items-center text-foreground hover:text-brand-primary-text hover:underline"
                        >
                          {a.title}
                        </Link>
                      </h3>
                      {text && (
                        <p className="line-clamp-2 font-sans text-base leading-relaxed text-muted-foreground">
                          {text}
                        </p>
                      )}
                      <p className="mt-2 font-sans text-base text-muted-foreground">
                        {timeAgo(publishedAt)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
            <SectionHeading title="Prayer" link={{ href: href("/prayer"), label: "All prayer requests" }} />
            {prayers === null ? (
              <ErrorState thing="prayer requests" />
            ) : prayers.length === 0 ? (
              <EmptyState icon={HeartHandshake} message="No prayer requests yet." />
            ) : (
              <ul>
                {prayers.map((p, i) => (
                  <li
                    key={p.id ?? i}
                    className="flex gap-3.5 border-t border-border py-4 first:border-0 first:pt-0"
                  >
                    <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-warm">
                      <HeartHandshake className="h-4 w-4 text-brand-primary" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="font-sans text-base font-semibold text-muted-foreground">
                        {prayerAuthorLabel(p)}
                      </div>
                      <div className="line-clamp-2 font-sans text-base text-foreground">
                        {p.body}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </PageContainer>
  );
}

function SectionHeading({ title, link }: { title: string; link?: { href: string; label: string } }) {
  return (
    <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4">
      <h2 className="font-serif text-3xl font-medium tracking-tight text-foreground">{title}</h2>
      {link && (
        <Link
          href={link.href}
          className="inline-flex min-h-11 items-center font-sans text-base font-semibold text-brand-primary-text hover:underline"
        >
          {link.label}
        </Link>
      )}
    </div>
  );
}
