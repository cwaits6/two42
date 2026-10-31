import Link from "next/link";
import { BookOpen, Play, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { Button } from "@/components/ui/button";
import { SegmentedLinks } from "@/components/ui/segmented";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";
import { formatLessonDate, lessonThumbnail, partNumbers } from "@/lib/lessons";
import { groupPageTitle } from "@/lib/pageTitle";
import { readList } from "@/lib/supabase/readList";
import { LessonList, MetaLine } from "./LessonList";

export const generateMetadata = groupPageTitle("Lessons");

type Lesson = {
  id: string;
  title: string;
  description: string | null;
  video_url: string;
  thumbnail_url: string | null;
  lecture_date: string | null;
  summary: string | null;
  series_id: string | null;
};

type Series = {
  id: string;
  name: string;
  teacher: string | null;
  is_archived: boolean;
};

export default async function LessonsPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { groupId } = await params;
  const group = await requireActiveGroup(groupId);
  const libraryHref = groupPath(group.id, "/lectures");
  const { view } = await searchParams;
  const supabase = await createClient();

  const [lessons, series] = await Promise.all([
    // Undated lessons last, so one never shows as the most recent.
    supabase
      .from("lectures")
      .select(
        "id, title, description, video_url, thumbnail_url, lecture_date, summary, series_id",
      )
      .eq("group_id", group.id)
      .order("lecture_date", { ascending: false, nullsFirst: false })
      .then((read) => readList<Lesson>(read, "lessons")),
    supabase
      .from("lecture_series")
      .select("id, name, teacher, is_archived")
      .eq("group_id", group.id)
      .order("created_at", { ascending: false })
      .then((read) => readList<Series>(read, "lesson series")),
  ]);

  return (
    <PageContainer>
      <PageHeader title="Lessons" subtitle={`Recordings and lesson summaries from ${group.name}.`} />
      {lessons === null || series === null ? (
        <ErrorState thing="lessons" />
      ) : lessons.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          message="No lessons yet."
          action={
            group.role === "leader" && (
              <Button
                nativeButton={false}
                render={<Link href={groupPath(group.id, "/settings/lectures/new")} />}
              >
                <Plus aria-hidden="true" />
                Add lesson
              </Button>
            )
          }
        />
      ) : (
        <Library
          libraryHref={libraryHref}
          lessons={lessons}
          series={series}
          isAllView={view === "all"}
        />
      )}
    </PageContainer>
  );
}

function Library({
  libraryHref,
  lessons,
  series,
  isAllView,
}: {
  libraryHref: string;
  lessons: Lesson[];
  series: Series[];
  isAllView: boolean;
}) {
  const parts = partNumbers(lessons);
  const partLabel = (id: string) => {
    const part = parts.get(id);
    return part ? `Part ${part}` : null;
  };
  const dateLabel = (lesson: Lesson) =>
    lesson.lecture_date ? formatLessonDate(lesson.lecture_date) : null;

  const seriesName = (lesson: Lesson) =>
    series.find((s) => s.id === lesson.series_id)?.name;

  const currentSeries = series.filter((s) => !s.is_archived);
  const pastSeries = series.filter((s) => s.is_archived);
  const currentIds = new Set(currentSeries.map((s) => s.id));
  const standalone = lessons.filter((l) => !l.series_id);
  const latest =
    lessons.find((l) => l.series_id && currentIds.has(l.series_id)) ?? standalone[0] ?? null;

  return (
    <>
      {latest && (
        <LatestLesson
          libraryHref={libraryHref}
          lesson={latest}
          meta={[seriesName(latest), partLabel(latest.id), dateLabel(latest)]}
        />
      )}

      <SegmentedLinks
        label="Show lessons"
        className="mt-10 mb-8"
        options={[
          { href: libraryHref, label: "By series", current: !isAllView },
          { href: `${libraryHref}?view=all`, label: "All lessons", current: isAllView },
        ]}
      />

      {isAllView ? (
        <LessonList
          libraryHref={libraryHref}
          lessons={lessons.map((l) => ({
            id: l.id,
            title: l.title,
            meta: [seriesName(l), partLabel(l.id), dateLabel(l)],
          }))}
        />
      ) : (
        <div className="space-y-12">
          {currentSeries.map((s) => {
            const inSeries = lessons.filter((l) => l.series_id === s.id);
            if (inSeries.length === 0) return null;
            return (
              <section key={s.id} aria-labelledby={`series-${s.id}`}>
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                  <div className="min-w-0">
                    <h2
                      id={`series-${s.id}`}
                      className="font-serif text-2xl font-medium text-foreground"
                    >
                      {s.name}
                    </h2>
                    <MetaLine
                      parts={[
                        s.teacher && `Taught by ${s.teacher}`,
                        `${inSeries.length} ${inSeries.length === 1 ? "lesson" : "lessons"}`,
                      ]}
                    />
                  </div>
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={<Link href={`${libraryHref}/series/${s.id}`} />}
                    aria-label={`View series ${s.name}`}
                  >
                    View series
                  </Button>
                </div>
                <LessonList
                  libraryHref={libraryHref}
                  lessons={inSeries.map((l) => ({
                    id: l.id,
                    title: l.title,
                    description: l.description,
                    meta: [partLabel(l.id), dateLabel(l)],
                  }))}
                />
              </section>
            );
          })}

          {standalone.length > 0 && (
            <section aria-labelledby="other-lessons">
              <h2
                id="other-lessons"
                className="mb-4 font-serif text-2xl font-medium text-foreground"
              >
                Other lessons
              </h2>
              <LessonList
                libraryHref={libraryHref}
                lessons={standalone.map((l) => ({
                  id: l.id,
                  title: l.title,
                  description: l.description,
                  meta: [dateLabel(l)],
                }))}
              />
            </section>
          )}

          {pastSeries.length > 0 && (
            <section aria-labelledby="past-series">
              <h2
                id="past-series"
                className="mb-4 font-serif text-2xl font-medium text-foreground"
              >
                Past series
              </h2>
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {pastSeries.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`${libraryHref}/series/${s.id}`}
                      className="group block h-full rounded-2xl border border-border bg-card px-5 py-4 transition-colors hover:bg-muted/50"
                    >
                      <span className="block text-lg font-medium text-foreground group-hover:text-brand-primary-text">
                        {s.name}
                      </span>
                      {s.teacher && (
                        <span className="block text-base text-muted-foreground">
                          Taught by {s.teacher}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  );
}

function LatestLesson({
  libraryHref,
  lesson,
  meta,
}: {
  libraryHref: string;
  lesson: Lesson;
  meta: React.ReactNode[];
}) {
  const href = `${libraryHref}/${lesson.id}`;
  const thumbnail = lessonThumbnail(lesson);

  return (
    <section
      aria-labelledby="latest-lesson"
      className="grid gap-6 rounded-2xl border border-border bg-card p-5 md:grid-cols-[1.3fr_1fr] md:items-center"
    >
      {/* The title link below names the same page; this one is for pointers only. */}
      <Link
        href={href}
        tabIndex={-1}
        aria-hidden="true"
        className="group relative block aspect-video overflow-hidden rounded-xl bg-brand-warm"
      >
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element -- Lesson thumbnails can be arbitrary stored URLs.
          <img src={thumbnail} alt="" className="h-full w-full object-cover" />
        ) : (
          <BookOpen className="absolute inset-0 m-auto size-12 text-brand-primary-text" />
        )}
        <span className="absolute inset-0 m-auto flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform group-hover:scale-105">
          <Play className="size-7 fill-current" />
        </span>
      </Link>

      <div className="min-w-0">
        <p className="text-base font-medium text-muted-foreground">Most recent</p>
        <h2
          id="latest-lesson"
          className="mt-1 font-serif text-3xl font-medium text-foreground"
        >
          <Link href={href} className="hover:text-brand-primary-text">
            {lesson.title}
          </Link>
        </h2>
        <MetaLine parts={meta} className="mt-2 block text-base text-muted-foreground" />
        {lesson.description && (
          <p className="mt-3 text-lg text-muted-foreground">{lesson.description}</p>
        )}
        {lesson.summary && (
          <div className="mt-4">
            <h3 className="text-base font-semibold text-foreground">Lesson summary</h3>
            <p className="mt-1 text-lg leading-relaxed text-foreground line-clamp-4 whitespace-pre-wrap">
              {lesson.summary}
            </p>
          </div>
        )}
        <Button
          className="mt-5"
          nativeButton={false}
          render={<Link href={href} />}
          aria-label={`View lesson ${lesson.title}`}
        >
          View lesson
        </Button>
      </div>
    </section>
  );
}
