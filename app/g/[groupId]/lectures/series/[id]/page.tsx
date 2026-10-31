import { notFound } from "next/navigation";
import { BookOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";
import { formatLessonDate, lessonsInOrder, partNumbers, seriesDateRange } from "@/lib/lessons";
import { pageTitle } from "@/lib/pageTitle";
import { readList } from "@/lib/supabase/readList";
import { LessonList, MetaLine } from "../../LessonList";

type SeriesLesson = {
  id: string;
  title: string;
  description: string | null;
  lecture_date: string | null;
  series_id: string | null;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ groupId: string; id: string }>;
}) {
  const { groupId, id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("lecture_series")
    .select("name")
    .eq("id", id)
    .eq("group_id", groupId)
    .maybeSingle();
  return pageTitle(data?.name ?? "Series", { groupId });
}

export default async function SeriesPage({
  params,
}: {
  params: Promise<{ groupId: string; id: string }>;
}) {
  const { groupId, id } = await params;
  const group = await requireActiveGroup(groupId);
  const libraryHref = groupPath(group.id, "/lectures");
  const supabase = await createClient();

  const [seriesRead, lessonsRead] = await Promise.all([
    supabase
      .from("lecture_series")
      .select("id, name, teacher, is_archived")
      .eq("id", id)
      .eq("group_id", group.id)
      .maybeSingle(),
    supabase
      .from("lectures")
      .select("id, title, description, lecture_date, series_id")
      .eq("series_id", id)
      .eq("group_id", group.id),
  ]);

  if (seriesRead.error) {
    console.error(
      "Failed to load series: code=%s message=%s",
      seriesRead.error.code,
      seriesRead.error.message,
    );
    return (
      <PageContainer>
        <PageHeader title="Series" backHref={libraryHref} backLabel="Back to Lessons" />
        <ErrorState thing="this series" />
      </PageContainer>
    );
  }
  const series = seriesRead.data;
  if (!series) notFound();

  const lessons = readList<SeriesLesson>(lessonsRead, "lessons in series");
  const parts = lessons ? partNumbers(lessons) : new Map<string, number>();

  return (
    <PageContainer>
      <PageHeader
        title={series.name}
        subtitle={series.teacher ? `Taught by ${series.teacher}` : undefined}
        backHref={libraryHref}
        backLabel="Back to Lessons"
        className="mb-4"
      />
      <MetaLine
        className="mb-8 block text-lg text-muted-foreground"
        parts={[
          series.is_archived ? "Past series" : "Current series",
          lessons && `${lessons.length} ${lessons.length === 1 ? "lesson" : "lessons"}`,
          lessons && seriesDateRange(lessons, series.is_archived),
        ]}
      />

      {lessons === null ? (
        <ErrorState thing="the lessons in this series" />
      ) : lessons.length === 0 ? (
        <EmptyState icon={BookOpen} message="No lessons in this series yet." />
      ) : (
        <LessonList
          libraryHref={libraryHref}
          lessons={lessonsInOrder(lessons)
            .reverse()
            .map((l) => ({
              id: l.id,
              title: l.title,
              description: l.description,
              meta: [
                `Part ${parts.get(l.id)}`,
                l.lecture_date && formatLessonDate(l.lecture_date),
              ],
            }))}
        />
      )}
    </PageContainer>
  );
}
