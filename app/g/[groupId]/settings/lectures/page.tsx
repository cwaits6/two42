import Link from "next/link";
import { BookOpen, CircleCheck, PenLine, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { Button } from "@/components/ui/button";
import { SegmentedLinks } from "@/components/ui/segmented";
import { groupPath } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";
import { formatLessonDate, needsSummary, partNumbers } from "@/lib/lessons";
import { groupPageTitle } from "@/lib/pageTitle";
import { readList } from "@/lib/supabase/readList";

export const generateMetadata = groupPageTitle("Manage lessons");

type LessonRow = {
  id: string;
  title: string;
  lecture_date: string | null;
  summary: string | null;
  series_id: string | null;
};

export default async function ManageLessonsPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  const base = groupPath(group.id, "/settings/lectures");
  const { filter } = await searchParams;
  const isNeedsSummaryView = filter === "needs-summary";
  const supabase = await createClient();

  const [lessons, series] = await Promise.all([
    supabase
      .from("lectures")
      .select("id, title, lecture_date, summary, series_id")
      .eq("group_id", group.id)
      .order("lecture_date", { ascending: false, nullsFirst: false })
      .then((read) => readList<LessonRow>(read, "lessons")),
    supabase
      .from("lecture_series")
      .select("id, name")
      .eq("group_id", group.id)
      .then((read) => readList<{ id: string; name: string }>(read, "lesson series")),
  ]);

  const addLesson = (
    <Button nativeButton={false} render={<Link href={`${base}/new`} />}>
      <Plus aria-hidden="true" />
      Add lesson
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Lessons"
        subtitle={`Lessons, series and lesson summaries for ${group.name}.`}
        backHref={groupPath(group.id, "/settings")}
        backLabel="Back to Group settings"
        actions={
          <>
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href={`${base}/series`} />}
            >
              Manage series
            </Button>
            {addLesson}
          </>
        }
      />

      {lessons === null || series === null ? (
        <ErrorState thing="lessons" />
      ) : lessons.length === 0 ? (
        <EmptyState icon={BookOpen} message="No lessons yet." action={addLesson} />
      ) : (
        <LessonCards
          base={base}
          lessons={lessons}
          seriesNames={new Map(series.map((s) => [s.id, s.name]))}
          isNeedsSummaryView={isNeedsSummaryView}
        />
      )}
    </PageContainer>
  );
}

function LessonCards({
  base,
  lessons,
  seriesNames,
  isNeedsSummaryView,
}: {
  base: string;
  lessons: LessonRow[];
  seriesNames: Map<string, string>;
  isNeedsSummaryView: boolean;
}) {
  const parts = partNumbers(lessons);
  const awaiting = lessons.filter((l) => needsSummary(l.summary));
  const shown = isNeedsSummaryView ? awaiting : lessons;

  return (
    <>
      <SegmentedLinks
        label="Show lessons"
        className="mb-6"
        options={[
          { href: base, label: `All lessons (${lessons.length})`, current: !isNeedsSummaryView },
          {
            href: `${base}?filter=needs-summary`,
            label: `Needs summary (${awaiting.length})`,
            current: isNeedsSummaryView,
          },
        ]}
      />

      {shown.length === 0 ? (
        <EmptyState icon={CircleCheck} message="Every lesson has a summary." />
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          {shown.map((lesson) => {
            const part = parts.get(lesson.id);
            const series = [lesson.series_id && seriesNames.get(lesson.series_id), part && `Part ${part}`]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={lesson.id}>
                <Link
                  href={`${base}/${lesson.id}/edit`}
                  className="flex min-h-16 flex-col gap-1 px-5 py-4 transition-colors hover:bg-muted/50 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
                >
                  <span className="min-w-0">
                    <span className="block text-lg font-medium text-foreground">
                      {lesson.title}
                    </span>
                    <span className="block text-base text-muted-foreground">
                      {series || "No series"}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:justify-end">
                    <span className="whitespace-nowrap text-base text-muted-foreground">
                      {lesson.lecture_date ? formatLessonDate(lesson.lecture_date) : "No date"}
                    </span>
                    {needsSummary(lesson.summary) && (
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-base font-medium text-foreground">
                        <PenLine className="size-4 text-brand-primary-text" aria-hidden="true" />
                        Needs summary
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
