import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { groupPath, type ActiveGroup } from "@/lib/groups/active";
import { loadHomeCards, type HomeEvent } from "@/lib/groups/home";

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function nextLine(event: HomeEvent | null): string {
  if (!event) return "No upcoming events";
  const d = new Date(event.start_time);
  const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `Next: ${weekday} · ${time}`;
}

function weekRowLabel(event: HomeEvent): string {
  const d = new Date(event.start_time);
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day} · ${time}`;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Home for a member of two or more groups: one card per group, then the week. */
export async function HomeLauncher({
  memberships,
  discoveryOn,
  displayName,
  orgId,
}: {
  memberships: ActiveGroup[];
  discoveryOn: boolean;
  displayName: string;
  orgId: string;
}) {
  const supabase = await createClient();
  const { cards, thisWeek } = await loadHomeCards(supabase, { orgId, groups: memberships });
  const groupNames = new Map(memberships.map((g) => [g.id, g]));

  return (
    <div className="min-h-screen bg-background">
      <section className="px-4 pt-14 pb-10 md:px-14">
        <h1 className="font-serif text-5xl md:text-6xl font-medium leading-none tracking-tight text-foreground mb-9">
          {getGreeting()}, <em className="text-brand-primary italic">{displayName}</em>.
        </h1>

        <div className="flex items-baseline justify-between mb-5">
          <h2 className="font-serif text-[30px] font-medium text-foreground tracking-tight">
            Your groups
          </h2>
          {discoveryOn && (
            <Link
              href="/find-a-group"
              className="font-sans text-base font-semibold text-brand-primary hover:underline"
            >
              Find a group →
            </Link>
          )}
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {cards.map(({ group, nextEvent, announcementCount, prayerCount }) => (
            <Link
              key={group.id}
              href={groupPath(group.id, "/dashboard")}
              className="relative overflow-hidden rounded-2xl border border-border bg-card p-6 pl-8 transition-colors hover:border-brand-primary"
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-2"
                style={{ background: group.color }}
              />
              <div className="flex items-start justify-between gap-3">
                <span className="font-serif text-2xl font-medium text-foreground leading-tight">
                  {group.name}
                </span>
                {group.role === "leader" && (
                  <span className="shrink-0 rounded border border-brand-accent/40 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wider text-brand-accent-text">
                    Leader
                  </span>
                )}
              </div>
              <p className="mt-3 font-sans text-base text-foreground">{nextLine(nextEvent)}</p>
              <p className="mt-1 font-sans text-base text-muted-foreground">
                {plural(announcementCount, "announcement")} · {plural(prayerCount, "prayer request")}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section className="border-t border-border bg-card px-4 py-10 md:px-14 md:pb-16">
        <h2 className="font-serif text-[30px] font-medium text-foreground tracking-tight mb-5">
          This week
        </h2>
        {thisWeek.length === 0 ? (
          <p className="text-muted-foreground text-base">Nothing on the calendar this week.</p>
        ) : (
          <ul>
            {thisWeek.map(({ event, groupId }, i) => {
              const group = groupId ? groupNames.get(groupId) : undefined;
              return (
                <li
                  key={`${event.id}-${event.start_time}`}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-4"
                  style={i > 0 ? { borderTop: "1px solid var(--color-border)" } : undefined}
                >
                  <span className="font-mono text-base text-muted-foreground">
                    {weekRowLabel(event)}
                  </span>
                  <span className="font-serif text-xl font-medium text-foreground">
                    {event.title}
                  </span>
                  {event.location && (
                    <span className="font-sans text-base text-muted-foreground">
                      {event.location}
                    </span>
                  )}
                  {group && (
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 font-sans text-sm text-foreground">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 rounded-full"
                        style={{ background: group.color }}
                      />
                      {group.name}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
