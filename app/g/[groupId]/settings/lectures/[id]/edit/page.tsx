import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { groupPath } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";
import { readList } from "@/lib/supabase/readList";
import { LessonForm } from "../../LessonForm";
import { lessonDraftFrom } from "../../lessonDraft";

export const generateMetadata = groupPageTitle("Edit lesson");

export default async function EditLessonPage({
  params,
}: {
  params: Promise<{ groupId: string; id: string }>;
}) {
  const { groupId, id } = await params;
  const group = await requireGroupLeader(groupId);
  const supabase = await createClient();

  const [lessonRead, seriesRead] = await Promise.all([
    supabase
      .from("lectures")
      .select("id, series_id, title, video_url, lecture_date, description, summary, thumbnail_url")
      .eq("id", id)
      .eq("group_id", group.id)
      .maybeSingle(),
    supabase
      .from("lecture_series")
      .select("id, name, teacher")
      .eq("group_id", group.id)
      .order("created_at", { ascending: false }),
  ]);
  if (lessonRead.error) {
    console.error(
      "Failed to load lesson: code=%s message=%s",
      lessonRead.error.code,
      lessonRead.error.message,
    );
  } else if (!lessonRead.data) {
    notFound();
  }
  const lesson = lessonRead.data;
  const series = readList(seriesRead, "lesson series");

  return (
    <PageContainer size="reading">
      <PageHeader
        title="Edit lesson"
        subtitle={`Posting to ${group.name}`}
        backHref={groupPath(group.id, "/settings/lectures")}
        backLabel="Back to Lessons"
      />
      {!lesson || series === null ? (
        <ErrorState thing="this lesson" />
      ) : (
        <LessonForm
          groupId={group.id}
          series={series}
          initial={lessonDraftFrom(lesson)}
          lesson={{ id: lesson.id, title: lesson.title }}
        />
      )}
    </PageContainer>
  );
}
