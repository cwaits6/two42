import { createClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { groupPath } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";
import { readList } from "@/lib/supabase/readList";
import { LessonForm } from "../LessonForm";
import { emptyLessonDraft } from "../lessonDraft";

export const generateMetadata = groupPageTitle("Add lesson");

export default async function NewLessonPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ series?: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  const { series: preselected } = await searchParams;
  const supabase = await createClient();

  const series = readList(
    await supabase
      .from("lecture_series")
      .select("id, name, teacher")
      .eq("group_id", group.id)
      .order("created_at", { ascending: false }),
    "lesson series",
  );

  return (
    <PageContainer size="reading">
      <PageHeader
        title="Add lesson"
        subtitle={`Posting to ${group.name}`}
        backHref={groupPath(group.id, "/settings/lectures")}
        backLabel="Back to Lessons"
      />
      {series === null ? (
        <ErrorState thing="the series list" />
      ) : (
        <LessonForm
          groupId={group.id}
          series={series}
          initial={emptyLessonDraft(series, preselected)}
        />
      )}
    </PageContainer>
  );
}
