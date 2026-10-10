import Link from "next/link";
import { redirect } from "next/navigation";
import { Calendar, Clock, HandHelping, HeartHandshake, MapPin } from "lucide-react";
import { siteConfig } from "@/lib/config";
import { createClient } from "@/lib/supabase/server";
import { groupPath, type ActiveGroup } from "@/lib/groups/active";
import { formatServiceDate, toDateString } from "@/lib/serving/sundays";
import { RsvpSegmented } from "@/components/groups/RsvpSegmented";
import { JoinMeetingBlock } from "@/components/events/JoinMeetingBlock";
import { expandUpcomingEvents } from "@/lib/recurrence";
import { meetingEndMs, ENDED_GRACE_MS, type MeetingFields } from "@/lib/meetings";
import type { Event, Rsvp } from "@/lib/types";

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

const timeZone = siteConfig.timeZone;

function eventTime(startTime: string): string {
  return new Date(startTime).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
}

function eventDayNumber(startTime: string): string {
  return new Date(startTime).toLocaleDateString("en-US", { day: "numeric", timeZone });
}

function eventWeekday(startTime: string): string {
  return new Date(startTime).toLocaleDateString("en-US", { weekday: "long", timeZone });
}

function eventMonth(startTime: string): string {
  return new Date(startTime).toLocaleDateString("en-US", { month: "short", timeZone }).toUpperCase();
}

function greeting(): string {
  const h = Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone }));
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function todayLabel(): string {
  const d = new Date();
  const weekday = d.toLocaleDateString("en-US", { weekday: "long", timeZone });
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone });
  return `${weekday} · ${date}`;
}

function relativeDay(startTime: string): string {
  const dayKey = (d: Date) => d.toLocaleDateString("en-CA", { timeZone });
  const start = new Date(startTime);
  const today = new Date();
  if (dayKey(start) === dayKey(today)) return "today";
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  if (dayKey(start) === dayKey(tomorrow)) return "tomorrow";
  const days = Math.round((Date.parse(dayKey(start)) - Date.parse(dayKey(today))) / (24 * 60 * 60 * 1000));
  return days > 1 ? `in ${days} days` : eventWeekday(startTime);
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

function prayerCategoryLabel(category: string | null): string {
  if (!category) return "Prayer";
  return category.charAt(0).toUpperCase() + category.slice(1);
}

// ── component ────────────────────────────────────────────────────────────────

/**
 * One group's dashboard. The content queries are still org-wide: the
 * content tables carry no group_id yet. `group` is in scope so the
 * group-scoped-content ticket only has to add the filter.
 */
export async function GroupDashboard({ group }: { group: ActiveGroup }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const nowDate = new Date();
  const now = nowDate.toISOString();

  // Next event for the hero. Recurring series are stored as a single anchor
  // row and expanded at render time, so fetch a window that also includes
  // anchors and recently-started occurrences (for the live/ended join states).
  const windowStart = new Date(nowDate.getTime() - 24 * 60 * 60 * 1000);
  const windowStartISO = windowStart.toISOString();

  // Phase A — every query below is independent of `nextEvent`; fire them
  // together instead of awaiting one at a time.
  const [
    { data: viewer },
    { data: rawEvents },
    { data: rsvps },
    { data: announcements },
    { count: lectureCount },
    { data: prayers },
    { data: myServings },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("preferred_name, first_name")
      .eq("id", user.id)
      .maybeSingle(),
    supabase
      .from("events")
      .select("*")
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
      .eq("is_published", true)
      .lte("published_at", now)
      .order("published_at", { ascending: false })
      .limit(3),
    supabase
      .from("lectures")
      .select("id", { count: "exact", head: true }),
    supabase
      .from("prayer_wall")
      .select("id, category, body, created_at")
      .order("created_at", { ascending: false })
      .limit(3),
    // Upcoming serving commitments for this member (inner join filters to user's rows)
    supabase
      .from("serving_signups")
      .select("id, service_date, group_id, teams(id, name), serving_signup_attendees!inner(profile_id)")
      .eq("serving_signup_attendees.profile_id", user.id)
      .gte("service_date", toDateString(new Date()))
      .order("service_date", { ascending: true })
      .limit(3),
  ]);

  // Keep the current occurrence on the hero through its live window plus a
  // short grace period (ended state points to the recording), then roll over.
  const occurrences = expandUpcomingEvents((rawEvents ?? []) as Event[], windowStart);
  const nextEvent =
    occurrences.find(
      (e) => meetingEndMs(e.start_time, e.end_time) + ENDED_GRACE_MS > nowDate.getTime()
    ) ?? null;

  let userRsvps: Record<string, Rsvp> = {};
  if (rsvps) {
    userRsvps = Object.fromEntries(rsvps.map((r) => [r.event_id, r]));
  }

  // serving_signups.group_id is a team id.
  const upcomingServings = (myServings ?? []) as Array<{
    id: string;
    service_date: string;
    group_id: string;
    teams: { id: string; name: string } | Array<{ id: string; name: string }> | null;
  }>;

  // Meeting fields live on the series anchor; exception rows inherit them.
  let meeting: MeetingFields | null = null;
  let goingCount = 0;
  let maybeCount = 0;

  // Phase B — these depend on `nextEvent`. The anchor lookup and the event's
  // RSVP list are mutually independent, so fetch them together.
  if (nextEvent) {
    const [anchor, { data: eventRsvps }] = await Promise.all([
      nextEvent.series_id
        ? supabase
            .from("events")
            .select(
              "meeting_url, meeting_id, meeting_passcode, meeting_show_on_dashboard, meeting_lead_minutes"
            )
            .eq("id", nextEvent.series_id)
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
    if (source.meeting_url && source.meeting_show_on_dashboard) meeting = source;

    if (eventRsvps) {
      goingCount = eventRsvps.filter((r) => r.status === "yes").length;
      maybeCount = eventRsvps.filter((r) => r.status === "maybe").length;
    }
  }

  const href = (path: string) => groupPath(group.id, path);

  const displayName = viewer?.preferred_name || viewer?.first_name || "Friend";

  return (
    <div className="min-h-screen bg-background">
      {/* ── Greeting, then the next meeting ─────────────────────────────── */}
      <section className="mx-auto max-w-[960px] px-4 pt-5 pb-8 md:px-8 md:pt-10">
        <div className="mb-4 flex items-center gap-3">
          <span aria-hidden="true" className="h-px w-8 bg-brand-accent" />
          <span className="font-sans text-[15px] font-bold uppercase tracking-[3px] text-brand-accent-text">
            {todayLabel()}
          </span>
        </div>
        <h1 className="mb-7 font-serif text-[40px] font-medium leading-none tracking-[-0.02em] text-foreground md:text-[56px]">
          {greeting()}, <em className="not-italic text-brand-primary">{displayName}</em>.
        </h1>

        {nextEvent ? (
          <div
            className="rounded-[18px] p-7 text-white"
            style={{
              background: "var(--color-brand-primary)",
              boxShadow:
                "0 14px 40px color-mix(in srgb, var(--color-brand-primary) 20%, transparent)",
            }}
          >
            <div className="mb-[18px] flex items-center gap-2.5 font-sans text-sm font-bold uppercase tracking-[1.5px]">
              <span aria-hidden="true" className="h-2 w-2 rounded-full bg-brand-accent" />
              Next meeting · {relativeDay(nextEvent.start_time)}
            </div>

            <div className="flex flex-wrap items-start gap-[22px]">
              {/* Date tile: Warm Paper ground, Espresso text */}
              <div
                className="flex h-[84px] w-[84px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-2xl"
                style={{ background: "var(--color-brand-warm)", color: "var(--color-brand-navy)" }}
              >
                <span className="font-sans text-[13px] font-bold uppercase leading-none tracking-[0.14em] text-secondary-foreground">
                  {eventWeekday(nextEvent.start_time).slice(0, 3)}
                </span>
                <span className="font-serif text-4xl font-semibold leading-none">
                  {eventDayNumber(nextEvent.start_time)}
                </span>
                <span className="font-sans text-[13px] font-semibold uppercase leading-none tracking-[0.08em] text-muted-foreground">
                  {eventMonth(nextEvent.start_time)}
                </span>
              </div>

              <div className="min-w-0 flex-1 pt-1">
                <div className="font-serif text-[32px] font-medium leading-[1.15] tracking-[-0.01em]">
                  {nextEvent.title}
                </div>
                <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2 font-sans text-[17px]">
                  <span className="inline-flex items-center gap-2">
                    <Clock className="h-[18px] w-[18px]" aria-hidden="true" />
                    {eventTime(nextEvent.start_time)}
                  </span>
                  {nextEvent.location && (
                    <span className="inline-flex items-center gap-2">
                      <MapPin className="h-[18px] w-[18px]" aria-hidden="true" />
                      {nextEvent.location}
                    </span>
                  )}
                </div>
                {nextEvent.description && (
                  <p className="mt-3 max-w-[52ch] font-sans text-[17px] leading-normal text-white/90">
                    {nextEvent.description.length > 160
                      ? nextEvent.description.slice(0, 160) + "…"
                      : nextEvent.description}
                  </p>
                )}
              </div>
            </div>

            <div
              className="mt-6 flex flex-wrap items-center justify-between gap-4 pt-[18px]"
              style={{ borderTop: "1px solid rgba(255,255,255,0.22)" }}
            >
              <div className="flex items-center gap-2.5 font-sans text-base">
                <span className="font-bold">Are you going?</span>
                <span className="text-[15px] text-white/90">
                  {goingCount > 0 ? (
                    <>
                      {goingCount} going
                      {maybeCount > 0 && <> · {maybeCount} maybe</>}
                    </>
                  ) : (
                    "Be the first to RSVP"
                  )}
                </span>
              </div>
              <RsvpSegmented
                eventId={nextEvent.id}
                userId={user.id}
                currentStatus={userRsvps[nextEvent.id]?.status ?? null}
              />
            </div>

            {/* Join the call — time-aware, set on the recurring event */}
            {meeting?.meeting_url && (
              <div className="mt-4">
                <JoinMeetingBlock
                  meetingUrl={meeting.meeting_url}
                  meetingId={meeting.meeting_id}
                  passcode={meeting.meeting_passcode}
                  startTime={nextEvent.start_time}
                  endTime={nextEvent.end_time}
                  leadMinutes={meeting.meeting_lead_minutes}
                  recordingsHref={lectureCount && lectureCount > 0 ? href("/lectures") : null}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-center rounded-[18px] border border-border bg-brand-warm p-10 text-center text-muted-foreground">
            <div>
              <Calendar className="mx-auto mb-3 h-10 w-10 text-brand-primary/40" />
              <p className="font-serif text-xl text-foreground/60">No upcoming events</p>
              <p className="mt-1 text-sm">Check back soon.</p>
            </div>
          </div>
        )}
      </section>

      {/* ── Your turn to serve ───────────────────────────────────────────── */}
      {upcomingServings.length > 0 && (
        <section className="px-4 pb-6 md:px-14">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center gap-2 mb-3">
              <HandHelping className="h-5 w-5 text-brand-primary" />
              <h2 className="font-sans text-sm font-semibold text-foreground uppercase tracking-wider">
                Your turn to serve
              </h2>
            </div>
            <div className="space-y-2">
              {upcomingServings.map((s) => (
                <Link
                  key={s.id}
                  href={href(`/serving/${s.group_id}`)}
                  className="flex items-center justify-between gap-4 py-2 border-t border-border first:border-0 hover:text-brand-primary transition-colors"
                >
                  <div>
                    <div className="font-sans text-sm font-semibold text-foreground">
                      {(Array.isArray(s.teams) ? s.teams[0]?.name : s.teams?.name) ?? "Serving team"}
                    </div>
                    <div className="font-sans text-xs text-muted-foreground mt-0.5">
                      {formatServiceDate(s.service_date)}
                    </div>
                  </div>
                  <span className="font-sans text-xs font-semibold text-brand-primary shrink-0">
                    View →
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Bottom: Announcements + Prayer ───────────────────────────────── */}
      <section className="border-t border-border bg-card px-4 py-10 md:px-14 md:pb-16 grid gap-8 grid-cols-1 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <div className="flex items-baseline justify-between mb-5">
            <h2 className="font-serif text-[30px] font-medium text-foreground tracking-tight">
              Announcements
            </h2>
            <Link
              href={href("/announcements")}
              className="font-sans text-base font-semibold text-brand-primary hover:underline"
            >
              See all →
            </Link>
          </div>

          {announcements && announcements.length > 0 ? (
            <div>
              {announcements.map((a, i) => {
                const publishedAt = a.published_at || a.created_at;
                const text = excerpt(a.content);
                return (
                  <div
                    key={a.id}
                    className="py-5 grid grid-cols-[1fr_auto] gap-5 items-start"
                    style={i > 0 ? { borderTop: "1px solid var(--color-border)" } : undefined}
                  >
                    <div>
                      <h3 className="font-serif text-[22px] font-medium text-foreground tracking-tight leading-snug mb-1">
                        {a.title}
                      </h3>
                      {text && (
                        <p className="font-sans text-base text-muted-foreground leading-relaxed line-clamp-2">
                          {text}
                        </p>
                      )}
                      <p className="font-sans text-base text-muted-foreground mt-2">
                        {timeAgo(publishedAt)}
                      </p>
                    </div>
                    <Link
                      href={href(`/announcements/${a.id}`)}
                      className="font-sans text-base font-semibold text-brand-primary hover:underline whitespace-nowrap pt-1"
                    >
                      Read →
                    </Link>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground text-base">No announcements yet.</p>
          )}
        </div>

        <div>
          <div className="flex items-baseline justify-between mb-5">
            <h2 className="font-serif text-[30px] font-medium text-foreground tracking-tight">
              Prayer
            </h2>
            <Link
              href={href("/prayer")}
              className="font-sans text-base font-semibold text-brand-primary hover:underline"
            >
              See all →
            </Link>
          </div>

          {prayers && prayers.length > 0 ? (
            <div>
              {prayers.map((p, i) => (
                <div
                  key={p.id ?? i}
                  className="flex gap-3.5 py-3.5"
                  style={i > 0 ? { borderTop: "1px solid var(--color-border)" } : undefined}
                >
                  <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-warm">
                    <HeartHandshake className="h-4 w-4 text-brand-primary" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-base text-muted-foreground uppercase tracking-wider">
                      {prayerCategoryLabel(p.category)}
                    </div>
                    <div className="font-sans text-base text-foreground line-clamp-2">
                      {p.body}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-muted-foreground text-base">No prayer requests yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
