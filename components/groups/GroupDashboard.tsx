import Link from "next/link";
import { redirect } from "next/navigation";
import { Calendar, HandHelping, HeartHandshake } from "lucide-react";
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

// Avatar colors — deterministic from index
const AVATAR_BG = [
  "var(--color-brand-accent)",
  "var(--color-avatar-rust)",
  "var(--color-avatar-sage)",
  "var(--color-avatar-tan)",
  "var(--color-avatar-slate)",
];

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
    { data: rawEvents },
    { data: rsvps },
    { data: announcements },
    { count: lectureCount },
    { data: prayers },
    { data: myServings },
  ] = await Promise.all([
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
  let attendeeInitials: string[] = [];

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
        .select("status, user_id")
        .eq("event_id", nextEvent.id),
    ]);

    let source: MeetingFields = nextEvent;
    if (anchor) source = anchor;
    if (source.meeting_url && source.meeting_show_on_dashboard) meeting = source;

    if (eventRsvps) {
      goingCount = eventRsvps.filter((r) => r.status === "yes").length;
      maybeCount = eventRsvps.filter((r) => r.status === "maybe").length;

      const yesIds = eventRsvps
        .filter((r) => r.status === "yes")
        .slice(0, 4)
        .map((r) => r.user_id);

      if (yesIds.length > 0) {
        const { data: attendeeProfiles } = await supabase
          .from("profiles")
          .select("id, first_name, last_name, preferred_name")
          .in("id", yesIds);

        if (attendeeProfiles) {
          attendeeInitials = attendeeProfiles.map((p) => {
            const fn = p.preferred_name || p.first_name || "?";
            const ln = p.last_name || "";
            return `${fn[0] ?? ""}${ln[0] ?? ""}`.toUpperCase();
          });
        }
      }
    }
  }

  const href = (path: string) => groupPath(group.id, path);

  return (
    <div className="min-h-screen bg-background">
      {/* ── Hero: the group, then its next meeting ───────────────────────── */}
      <section className="px-4 pt-14 pb-10 md:px-14">
        <div className="flex items-center gap-3 mb-5">
          <span
            aria-hidden="true"
            className="h-3 w-3 rounded-full shrink-0"
            style={{ background: group.color }}
          />
          <span className="text-brand-accent-text font-sans font-bold uppercase tracking-[3px] text-base">
            {group.role === "leader" ? "You lead this group" : "Your group"}
          </span>
        </div>
        <h1 className="font-serif text-5xl md:text-6xl font-medium leading-none tracking-tight text-foreground mb-9">
          {group.name}
        </h1>

        {nextEvent ? (
          <div
            className="rounded-[18px] p-8 relative overflow-hidden"
            style={{
              background: "var(--color-brand-primary)",
              boxShadow:
                "0 14px 40px color-mix(in srgb, var(--color-brand-primary) 20%, transparent)",
            }}
          >
            <div className="relative text-white">
              <div className="flex flex-col sm:flex-row gap-6">
                {/* Date tile: Warm Paper ground, Espresso text */}
                <div
                  className="flex w-28 shrink-0 flex-col items-center justify-center rounded-2xl px-3 py-4 text-center"
                  style={{ background: "var(--color-brand-warm)", color: "var(--color-brand-navy)" }}
                >
                  <span className="font-sans text-sm font-bold uppercase tracking-[2px]">
                    {eventWeekday(nextEvent.start_time)}
                  </span>
                  <span className="font-serif font-medium leading-none text-6xl mt-1">
                    {eventDayNumber(nextEvent.start_time)}
                  </span>
                  <span className="font-sans text-sm font-bold uppercase tracking-[2px] mt-1">
                    {eventMonth(nextEvent.start_time)}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <div
                    className="font-serif font-medium leading-[1.1]"
                    style={{ fontSize: 34, letterSpacing: "-0.5px" }}
                  >
                    {nextEvent.title}
                  </div>
                  <div className="font-sans text-base uppercase tracking-[2px] opacity-85 font-semibold mt-2">
                    {eventTime(nextEvent.start_time)}
                    {nextEvent.location ? ` · ${nextEvent.location}` : ""}
                  </div>
                  {nextEvent.description && (
                    <div className="font-serif italic text-[17px] opacity-85 mt-2">
                      {nextEvent.description.length > 80
                        ? nextEvent.description.slice(0, 80) + "…"
                        : nextEvent.description}
                    </div>
                  )}
                </div>
              </div>

              {/* Divider + RSVP row */}
              <div
                className="flex flex-col sm:flex-row sm:items-center gap-4 mt-6 pt-5"
                style={{ borderTop: "1px solid rgba(255,255,255,0.18)" }}
              >
                <div className="flex items-center gap-3 flex-1">
                  <div className="flex">
                    {(attendeeInitials.length > 0 ? attendeeInitials : ["?"])
                      .slice(0, 4)
                      .map((initials, i) => (
                        <div
                          key={i}
                          className="w-8 h-8 rounded-full border-2 flex items-center justify-center font-sans text-xs font-semibold text-white flex-shrink-0"
                          style={{
                            background: AVATAR_BG[i % AVATAR_BG.length],
                            borderColor: "var(--color-brand-primary)",
                            marginLeft: i === 0 ? 0 : -10,
                          }}
                        >
                          {initials}
                        </div>
                      ))}
                  </div>
                  <div className="font-sans text-sm opacity-90">
                    {goingCount > 0 ? (
                      <>
                        <strong style={{ color: "var(--color-brand-accent)" }}>
                          {goingCount} going
                        </strong>
                        {maybeCount > 0 && <> · {maybeCount} maybe</>}
                      </>
                    ) : (
                      <span className="opacity-60">Be the first to RSVP</span>
                    )}
                  </div>
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
          </div>
        ) : (
          <div className="rounded-[18px] bg-brand-warm border border-border flex items-center justify-center p-10 text-muted-foreground text-center">
            <div>
              <Calendar className="h-10 w-10 mx-auto mb-3 text-brand-primary/40" />
              <p className="font-serif text-xl text-foreground/60">No upcoming events</p>
              <p className="text-sm mt-1">Check back soon.</p>
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
