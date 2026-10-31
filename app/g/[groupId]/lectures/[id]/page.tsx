import Link from "next/link";
import { notFound } from "next/navigation";
import { BookOpen, ExternalLink, Play } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { Button } from "@/components/ui/button";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";
import { formatLessonDate, lessonThumbnail, partNumbers, safeHttpUrl } from "@/lib/lessons";
import { pageTitle } from "@/lib/pageTitle";
import { readList } from "@/lib/supabase/readList";
import { LessonList, MetaLine } from "../LessonList";

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

type Sibling = { id: string; title: string; lecture_date: string | null; series_id: string | null };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ groupId: string; id: string }>;
}) {
  const { groupId, id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("lectures")
    .select("title")
    .eq("id", id)
    .eq("group_id", groupId)
    .maybeSingle();
  return pageTitle(data?.title ?? "Lesson", { groupId });
}

export default async function LessonPage({
  params,
}: {
  params: Promise<{ groupId: string; id: string }>;
}) {
  const { groupId, id } = await params;
  const group = await requireActiveGroup(groupId);
  const libraryHref = groupPath(group.id, "/lectures");
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("lectures")
    .select(
      "id, title, description, video_url, thumbnail_url, lecture_date, summary, series_id",
    )
    .eq("id", id)
    .eq("group_id", group.id)
    .maybeSingle();

  if (error) {
    console.error("Failed to load lesson: code=%s message=%s", error.code, error.message);
    return (
      <PageContainer>
        <PageHeader title="Lesson" backHref={libraryHref} backLabel="Back to Lessons" />
        <ErrorState thing="this lesson" />
      </PageContainer>
    );
  }
  if (!data) notFound();
  const lesson: Lesson = data;

  // A failed series read only drops the series line, the part number and
  // the rest of the series; the lesson itself still shows.
  const [series, inSeries] = lesson.series_id
    ? await Promise.all([
        supabase
          .from("lecture_series")
          .select("id, name, teacher")
          .eq("id", lesson.series_id)
          .eq("group_id", group.id)
          .maybeSingle()
          .then(({ data }) => data),
        supabase
          .from("lectures")
          .select("id, title, lecture_date, series_id")
          .eq("series_id", lesson.series_id)
          .eq("group_id", group.id)
          .then((read) => readList<Sibling>(read, "lessons in series") ?? []),
      ])
    : [null, []];
  const parts = partNumbers(inSeries);
  const part = parts.get(lesson.id);
  const others = inSeries.filter((l) => l.id !== lesson.id);

  const videoUrl = safeHttpUrl(lesson.video_url);
  const thumbnail = lessonThumbnail(lesson);

  return (
    <PageContainer>
      <PageHeader
        title={lesson.title}
        subtitle={lesson.description}
        backHref={libraryHref}
        backLabel="Back to Lessons"
        className="mb-4"
      />

      <MetaLine
        className="mb-8 block text-lg text-muted-foreground"
        parts={[
          series && (
            <Link
              key="series"
              href={`${libraryHref}/series/${series.id}`}
              className="font-medium text-brand-primary-text underline underline-offset-4 hover:text-foreground"
            >
              {series.name}
            </Link>
          ),
          part && `Part ${part}`,
          lesson.lecture_date && formatLessonDate(lesson.lecture_date, "long"),
          series?.teacher && `Taught by ${series.teacher}`,
        ]}
      />

      <section
        aria-label="Recording"
        className="grid gap-6 rounded-2xl border border-border bg-card p-5 md:grid-cols-[1.4fr_1fr] md:items-center"
      >
        {videoUrl ? (
          <a
            href={videoUrl}
            target="_blank"
            rel="noopener noreferrer"
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
            <span className="absolute inset-0 m-auto flex size-20 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform group-hover:scale-105">
              <Play className="size-8 fill-current" />
            </span>
          </a>
        ) : (
          <div className="flex aspect-video items-center justify-center rounded-xl bg-muted">
            <p className="text-lg text-muted-foreground">Recording unavailable.</p>
          </div>
        )}

        {videoUrl && (
          <div className="flex flex-col gap-3">
            <Button
              size="lg"
              nativeButton={false}
              render={<a href={videoUrl} target="_blank" rel="noopener noreferrer" />}
            >
              <ExternalLink aria-hidden="true" />
              Watch recording
            </Button>
            <p className="text-base text-muted-foreground">Opens in a new tab.</p>
          </div>
        )}
      </section>

      <section aria-labelledby="lesson-summary" className="mt-12">
        <h2 id="lesson-summary" className="mb-4 font-serif text-2xl font-medium text-foreground">
          Lesson summary
        </h2>
        {lesson.summary ? (
          <p className="max-w-prose text-lg leading-relaxed text-foreground whitespace-pre-wrap">
            {lesson.summary}
          </p>
        ) : (
          <p className="text-lg text-muted-foreground">No lesson summary yet.</p>
        )}
      </section>

      {series && others.length > 0 && (
        <section aria-labelledby="more-in-series" className="mt-12">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h2 id="more-in-series" className="font-serif text-2xl font-medium text-foreground">
              More from {series.name}
            </h2>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href={`${libraryHref}/series/${series.id}`} />}
            >
              View series
            </Button>
          </div>
          <LessonList
            libraryHref={libraryHref}
            lessons={others
              .sort((a, b) => (parts.get(a.id) ?? 0) - (parts.get(b.id) ?? 0))
              .slice(0, 5)
              .map((l) => ({
                id: l.id,
                title: l.title,
                meta: [
                  parts.has(l.id) && `Part ${parts.get(l.id)}`,
                  l.lecture_date && formatLessonDate(l.lecture_date),
                ],
              }))}
          />
        </section>
      )}
    </PageContainer>
  );
}
