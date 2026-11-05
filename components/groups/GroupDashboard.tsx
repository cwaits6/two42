import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Cake,
  Calendar,
  CalendarX,
  ChevronRight,
  CircleCheck,
  HandHeart,
  Heart,
  HeartHandshake,
  MapPin,
  Megaphone,
  Play,
  Plus,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import { LessonThumbnail } from "@/components/lessons/LessonThumbnail";
import { createClient } from "@/lib/supabase/server";
import { groupPath, type ActiveGroup } from "@/lib/groups/active";
import { greetingName } from "@/lib/groups/greeting";
import {
  buildGroupHome,
  tileAge,
  type CelebrationRow,
  type GroupHome,
  type HomeNotice,
  type NewTile,
  type ServingCard,
  type TodoRow,
  type WeekRow,
} from "@/lib/groups/groupHome";
import { loadGroupHomeReads } from "@/lib/groups/groupHomeReads";
import { PageContainer } from "@/components/layout/PageContainer";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { buttonVariants } from "@/components/ui/button-variants";
import { HomeGreeting } from "@/components/groups/HomeGreeting";
import { HomePrayerCard } from "@/components/groups/home/HomePrayerCard";
import { StartingNowPanel } from "@/components/groups/home/StartingNowPanel";
import { RsvpControl } from "@/components/events/RsvpControl";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { cn } from "@/lib/utils";

const CARD = "rounded-2xl border border-border bg-card";
const ROW = "flex min-h-16 items-center gap-3 rounded-2xl px-2 py-3 transition-colors hover:bg-muted";
const ROW_LEAD = "flex w-10 shrink-0 justify-center";
const ROW_TITLE = "font-sans text-lg font-semibold leading-snug text-foreground";
const ROW_DETAIL = "truncate font-sans text-base text-muted-foreground";
const EYEBROW = "font-sans text-sm font-semibold text-brand-accent-text";
const TILE_TITLE = "font-serif text-xl font-medium leading-snug tracking-tight text-foreground";

/** One group's Home: what changed, what needs you, this week, and what's new. */
export async function GroupDashboard({ group }: { group: ActiveGroup }) {
  const supabase = await createClient();
  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const [{ data: viewer }, timeZone] = await Promise.all([
    supabase
      .from("profiles")
      .select("org_id, preferred_name, first_name")
      .eq("id", user.id)
      .maybeSingle(),
    getOrgTimeZone(),
  ]);

  const greeting = (
    <HomeGreeting name={greetingName(viewer)} timeZone={timeZone} groupName={group.name} />
  );

  // Every read below filters on this org, so without it there is nothing to ask for.
  if (!viewer) {
    return (
      <PageContainer>
        {greeting}
        <ErrorState thing="Home" />
      </PageContainer>
    );
  }

  const now = new Date();
  const isLeader = group.role === "leader";
  const context = { groupId: group.id, isLeader, userId: user.id, timeZone, now };
  const reads = await loadGroupHomeReads(supabase, { ...context, orgId: viewer.org_id });
  const home = buildGroupHome(reads, context);
  const href = (path: string) => groupPath(group.id, path);

  if (home.nothingAtAll) {
    return (
      <PageContainer size="wide">
        {greeting}
        <NothingYet isLeader={isLeader} href={href} />
      </PageContainer>
    );
  }

  const showWeek =
    home.weekRows === null ||
    home.celebrations === null ||
    home.weekRows.length > 0 ||
    home.celebrations.length > 0 ||
    isLeader;
  const showNew = home.newTiles === null || home.newTiles.length > 0 || isLeader;
  const showPrayer = home.prayerFailed || home.prayer !== null;

  return (
    <PageContainer size="wide">
      {greeting}

      <div className="space-y-12">
        {home.startingNow && <StartingNowPanel event={home.startingNow} />}

        {home.notices.length > 0 && (
          <div className="space-y-3">
            {home.notices.map((notice) => (
              <NoticeCard key={notice.key} notice={notice} />
            ))}
          </div>
        )}

        {home.todo === null ? (
          <section>
            <SectionHeading title="To do" />
            <ErrorState thing="your to do list" />
          </section>
        ) : (
          home.todo.length > 0 && <TodoSection rows={home.todo} />
        )}

        {home.servingCards === null ? (
          <section>
            <SectionHeading title="Serving" />
            <ErrorState thing="serving dates" />
          </section>
        ) : (
          home.servingCards.length > 0 && (
            <div className="space-y-3">
              {home.servingCards.map((card) => (
                <ServingAsk key={card.teamId} card={card} />
              ))}
            </div>
          )
        )}

        <div
          className={cn(
            "grid grid-cols-1 gap-12",
            showWeek && (showNew || showPrayer) && "lg:grid-cols-[1.3fr_1fr] lg:gap-10",
          )}
        >
          {showWeek && (
            <ThisWeek home={home} userId={user.id} isLeader={isLeader} href={href} />
          )}

          {(showNew || showPrayer) && (
            <div className="min-w-0 space-y-12">
              {showNew && (
                <section>
                  <SectionHeading title="New in the group" />
                  {home.newTiles === null ? (
                    <ErrorState thing="what's new in the group" />
                  ) : home.newTiles.length === 0 ? (
                    <AddAction href={href("/announcements/new")} label="Add announcement" />
                  ) : (
                    <ul className="space-y-3">
                      {home.newTiles.map((tile) => (
                        <li key={tile.key}>
                          <Tile tile={tile} timeZone={timeZone} now={now} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {showPrayer && (
                <section>
                  <SectionHeading
                    title="Prayer"
                    link={{ href: href("/prayer"), label: "All requests" }}
                  />
                  {home.prayerFailed ? (
                    <ErrorState thing="prayer requests" />
                  ) : (
                    home.prayer && (
                      <ul>
                        <li>
                          <HomePrayerCard
                            key={home.prayer.id}
                            request={home.prayer}
                            userId={user.id}
                            groupId={group.id}
                          />
                        </li>
                      </ul>
                    )
                  )}
                </section>
              )}
            </div>
          )}
        </div>
      </div>
    </PageContainer>
  );
}

/** A group with nothing at all: the empty states, and for a leader the way to add the first thing. */
function NothingYet({ isLeader, href }: { isLeader: boolean; href: (path: string) => string }) {
  return (
    <div className="space-y-12">
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
      <div className="grid grid-cols-1 gap-12 lg:grid-cols-[1.3fr_1fr] lg:gap-8">
        <section>
          <SectionHeading
            title="Announcements"
            link={{ href: href("/announcements"), label: "All announcements" }}
          />
          <EmptyState
            icon={Megaphone}
            message="No announcements yet."
            action={
              isLeader && (
                <Link href={href("/announcements/new")} className={buttonVariants()}>
                  <Plus aria-hidden="true" />
                  Add announcement
                </Link>
              )
            }
          />
        </section>
        <section>
          <SectionHeading title="Prayer" link={{ href: href("/prayer"), label: "All requests" }} />
          <EmptyState icon={HeartHandshake} message="No prayer requests yet." />
        </section>
      </div>
    </div>
  );
}

function NoticeCard({ notice }: { notice: HomeNotice }) {
  const Icon = notice.kind === "skipped" ? CalendarX : MapPin;
  return (
    <Link
      href={notice.href}
      className="flex min-h-11 gap-3 rounded-2xl bg-brand-accent/25 p-4 transition-colors hover:bg-brand-accent/35"
    >
      <Icon className="mt-0.5 h-6 w-6 shrink-0 text-brand-accent-text" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block font-serif text-xl font-medium leading-snug tracking-tight text-foreground">
          {notice.title}
        </span>
        {notice.detail && (
          <span className="mt-0.5 block font-sans text-base text-foreground">{notice.detail}</span>
        )}
      </span>
    </Link>
  );
}

const TODO_ICONS: Record<TodoRow["kind"], LucideIcon> = {
  join: UserPlus,
  serving: HandHeart,
  announcement: Megaphone,
};

function TodoSection({ rows }: { rows: TodoRow[] }) {
  return (
    <section>
      <SectionHeading title="To do" />
      <ul className={cn(CARD, "p-1")}>
        {rows.map((row) => {
          const Icon = TODO_ICONS[row.kind];
          return (
            <li key={row.key}>
              <Link href={row.href} className={ROW}>
                <span className={ROW_LEAD}>
                  <Icon className="h-6 w-6 text-brand-primary-text" aria-hidden="true" />
                </span>
                <RowText title={row.title} detail={row.detail} />
                <RowChevron />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The ask, or once the viewer is on a date in the window, a plain card without the Clay button. */
function ServingAsk({ card }: { card: ServingCard }) {
  if (card.signedUp) {
    return (
      <section className={cn(CARD, "p-4")}>
        <h2 className={TILE_TITLE}>{card.title}</h2>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-4">
          <p className="flex items-center gap-2 font-sans text-base font-semibold text-foreground">
            <CircleCheck className="h-5 w-5 shrink-0 text-brand-success" aria-hidden="true" />
            You&apos;re signed up
          </p>
          <Link
            href={card.href}
            className="inline-flex min-h-11 items-center font-sans text-base font-semibold text-brand-primary-text hover:underline"
          >
            See open dates
          </Link>
        </div>
      </section>
    );
  }
  return (
    <section className="flex flex-col gap-4 rounded-2xl bg-brand-warm p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h2 className="font-serif text-2xl font-medium leading-snug tracking-tight text-foreground">
          {card.title}
        </h2>
        <p className="mt-1 font-sans text-base text-muted-foreground">{card.detail}</p>
      </div>
      <Link href={card.href} className={cn(buttonVariants({ size: "lg" }), "w-full sm:w-auto")}>
        See open dates
      </Link>
    </section>
  );
}

function ThisWeek({
  home,
  userId,
  isLeader,
  href,
}: {
  home: GroupHome;
  userId: string;
  isLeader: boolean;
  href: (path: string) => string;
}) {
  const rows = home.weekRows ?? [];
  const celebrations = home.celebrations ?? [];
  const hasRows = rows.length > 0 || celebrations.length > 0;
  const nothingFailed = home.weekRows !== null && home.celebrations !== null;

  return (
    <section className="min-w-0">
      <SectionHeading title="This week" link={{ href: href("/calendar"), label: "Calendar" }} />
      <div className="space-y-3">
        {home.weekRows === null && <ErrorState thing="this week's events" />}
        {hasRows && (
          <ul className={cn(CARD, "p-1")}>
            {rows.map((row) => (
              <WeekListRow key={row.key} row={row} userId={userId} />
            ))}
            {celebrations.map((row) => (
              <CelebrationListRow key={row.kind} row={row} />
            ))}
          </ul>
        )}
        {home.celebrations === null && <ErrorState thing="birthdays and anniversaries" />}
        {!hasRows && nothingFailed && isLeader && (
          <AddAction href={href("/calendar/new")} label="Add event" />
        )}
      </div>
    </section>
  );
}

function WeekListRow({ row, userId }: { row: WeekRow; userId: string }) {
  return (
    <li>
      <Link href={row.href} className={ROW}>
        <span className={cn(ROW_LEAD, "flex-col items-center leading-tight")}>
          <span className="font-sans text-sm font-semibold text-muted-foreground">{row.weekday}</span>
          <span className="font-serif text-2xl font-medium text-foreground">{row.day}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn(ROW_TITLE, "block")}>{row.title}</span>
          <span className={cn(ROW_DETAIL, "block")}>
            {[row.time, row.place].filter(Boolean).join(" · ")}
            {row.time && row.serving && " · "}
            {row.serving && (
              <span className="font-semibold text-brand-accent-text">You&apos;re serving</span>
            )}
          </span>
        </span>
        <RowChevron />
      </Link>
      {row.reply && (
        <div className="pb-3 pl-[3.75rem] pr-2">
          <RsvpControl
            eventId={row.reply.eventId}
            userId={userId}
            currentStatus={row.reply.status}
            tone="quiet"
          />
        </div>
      )}
    </li>
  );
}

function CelebrationListRow({ row }: { row: CelebrationRow }) {
  const Icon = row.kind === "birthday" ? Cake : Heart;
  return (
    <li>
      <Link href={row.href} className={ROW}>
        <span className={ROW_LEAD}>
          <Icon className="h-6 w-6 text-brand-primary-text" aria-hidden="true" />
        </span>
        <RowText title={row.title} detail={row.names} />
        <RowChevron />
      </Link>
    </li>
  );
}

function Tile({ tile, timeZone, now }: { tile: NewTile; timeZone: string; now: Date }) {
  const age = tileAge(tile.at, timeZone, now);
  const shell = cn(CARD, "block p-4 transition-colors hover:bg-muted");

  switch (tile.kind) {
    case "lesson":
      return (
        <Link href={tile.href} className={cn(shell, "flex items-center gap-4")}>
          <span className="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-brand-warm">
            <LessonThumbnail
              src={tile.thumbnail}
              fallback={<Play className="h-7 w-7 text-brand-primary-text" aria-hidden="true" />}
            />
          </span>
          <span className="min-w-0">
            <span className={cn(EYEBROW, "block")}>Lesson</span>
            <span className={cn(TILE_TITLE, "block")}>{tile.title}</span>
            {tile.detail && <span className={cn(ROW_DETAIL, "block")}>{tile.detail}</span>}
          </span>
        </Link>
      );
    case "announcement":
      return (
        <Link href={tile.href} className={shell}>
          <span className={cn(EYEBROW, "block")}>Announcement · {age}</span>
          <span className={cn(TILE_TITLE, "block")}>{tile.title}</span>
          {tile.text && (
            <span className="mt-0.5 line-clamp-2 hidden font-sans text-base text-muted-foreground lg:block">
              {tile.text}
            </span>
          )}
        </Link>
      );
    case "prayer":
      return (
        <Link href={tile.href} className={shell}>
          <span className={cn(EYEBROW, "flex items-center gap-1.5")}>
            <CircleCheck className="h-4 w-4 shrink-0 text-brand-success" aria-hidden="true" />
            Prayer answered · {age}
          </span>
          <span className={cn(TILE_TITLE, "line-clamp-2")}>{tile.body}</span>
          {tile.name && <span className={cn(ROW_DETAIL, "block")}>{tile.name}</span>}
        </Link>
      );
    case "joined":
      return (
        <Link href={tile.href} className={shell}>
          <span className={cn(EYEBROW, "block")}>New to the group · {age}</span>
          <span className={cn(TILE_TITLE, "block")}>{tile.names} joined</span>
        </Link>
      );
  }
}

function AddAction({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={buttonVariants({ variant: "secondary" })}>
      <Plus aria-hidden="true" />
      {label}
    </Link>
  );
}

function RowText({ title, detail }: { title: string; detail: string }) {
  return (
    <span className="min-w-0 flex-1">
      <span className={cn(ROW_TITLE, "block")}>{title}</span>
      <span className={cn(ROW_DETAIL, "block")}>{detail}</span>
    </span>
  );
}

function RowChevron() {
  return <ChevronRight className="h-5 w-5 shrink-0 text-brand-primary-text" aria-hidden="true" />;
}

function SectionHeading({ title, link }: { title: string; link?: { href: string; label: string } }) {
  return (
    <div className="mb-3 flex min-h-11 flex-wrap items-baseline justify-between gap-x-4">
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
