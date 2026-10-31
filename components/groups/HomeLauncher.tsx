import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PageContainer } from "@/components/layout/PageContainer";
import { ErrorState } from "@/components/states/ErrorState";
import { HomeGreeting } from "@/components/groups/HomeGreeting";
import { createClient } from "@/lib/supabase/server";
import { groupPath, type ActiveGroup } from "@/lib/groups/active";
import { loadHomeCards, type HomeCard, type HomeEvent } from "@/lib/groups/home";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { formatEventTime, formatInZone } from "@/lib/time/zone";

// Every time below is the org's wall clock: `timeZone` is the org zone the
// component resolves once per request.

function nextLine(event: HomeEvent | null, timeZone: string): string {
  if (!event) return "No upcoming events";
  const weekday = formatInZone(event.start_time, timeZone, { weekday: "long" });
  return `Next: ${weekday} · ${formatEventTime(event.start_time, timeZone)}`;
}

function weekRowLabel(event: HomeEvent, timeZone: string): string {
  const day = formatInZone(event.start_time, timeZone, { weekday: "short", month: "short", day: "numeric" });
  return `${day} · ${formatEventTime(event.start_time, timeZone)}`;
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

type CardActivity = Pick<HomeCard, "nextEvent" | "announcementCount" | "prayerCount">;

/** A group card; without activity it is only the link into the group. */
function GroupCard({
  group,
  activity,
  timeZone,
}: {
  group: ActiveGroup;
  activity: CardActivity | null;
  timeZone: string;
}) {
  return (
    <Link
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
          <Badge variant="role">Leader</Badge>
        )}
      </div>
      {activity && (
        <>
          <p className="mt-3 font-sans text-base text-foreground">
            {nextLine(activity.nextEvent, timeZone)}
          </p>
          <p className="mt-1 font-sans text-base text-muted-foreground">
            {plural(activity.announcementCount, "announcement")} ·{" "}
            {plural(activity.prayerCount, "prayer request")}
          </p>
        </>
      )}
    </Link>
  );
}

/**
 * Home for a member of two or more groups: one card per group, then the week.
 * When the loader reports a failed read the cards stay as links into each
 * group and the page says so, rather than showing an empty week and zero counts.
 */
export async function HomeLauncher({
  memberships,
  discoveryOn,
  displayName,
  orgId,
}: {
  memberships: ActiveGroup[];
  discoveryOn: boolean;
  displayName: string | null;
  orgId: string;
}) {
  const supabase = await createClient();
  const timeZone = await getOrgTimeZone();
  const home = await loadHomeCards(supabase, { orgId, groups: memberships, timeZone });
  const cards = home
    ? home.cards.map((card) => ({ group: card.group, activity: card }))
    : memberships.map((group) => ({ group, activity: null }));
  const groupNames = new Map(memberships.map((g) => [g.id, g]));

  return (
    <PageContainer>
      <HomeGreeting name={displayName} timeZone={timeZone} />

      <div className="space-y-12">
        {!home && <ErrorState thing="your groups' activity" />}

        <section>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 className="font-serif text-3xl font-medium tracking-tight text-foreground">
              Your groups
            </h2>
            {discoveryOn && (
              <Link
                href="/find-a-group"
                className="inline-flex min-h-11 items-center font-sans text-base font-semibold text-brand-primary-text hover:underline"
              >
                Find a group
              </Link>
            )}
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            {cards.map(({ group, activity }) => (
              <GroupCard key={group.id} group={group} activity={activity} timeZone={timeZone} />
            ))}
          </div>
        </section>

        {home && (
          <section>
            <h2 className="mb-4 font-serif text-3xl font-medium tracking-tight text-foreground">
              This week
            </h2>
            {home.thisWeek.length === 0 ? (
              <p className="font-sans text-base text-muted-foreground">Nothing on the calendar this week.</p>
            ) : (
              <ul>
                {home.thisWeek.map(({ event, groupId }) => {
                  const group = groupNames.get(groupId);
                  return (
                    <li
                      key={`${event.id}-${event.start_time}`}
                      className="border-t border-border py-4 first:border-0 first:pt-0"
                    >
                      <div className="font-sans text-base text-muted-foreground">
                        {weekRowLabel(event, timeZone)}
                      </div>
                      <div className="font-serif text-xl font-medium text-foreground">{event.title}</div>
                      {(event.location || group) && (
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
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
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>
    </PageContainer>
  );
}
