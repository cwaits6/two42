import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { groupPath } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";
import { SeriesForm } from "../../SeriesForm";

export const generateMetadata = groupPageTitle("Edit series");

export default async function EditSeriesPage({
  params,
}: {
  params: Promise<{ groupId: string; id: string }>;
}) {
  const { groupId, id } = await params;
  const group = await requireGroupLeader(groupId);
  const supabase = await createClient();

  const { data: series, error } = await supabase
    .from("lecture_series")
    .select("id, name, teacher, is_archived")
    .eq("id", id)
    .eq("group_id", group.id)
    .maybeSingle();
  if (error) {
    console.error("Failed to load series: code=%s message=%s", error.code, error.message);
  } else if (!series) {
    notFound();
  }

  return (
    <PageContainer size="reading">
      <PageHeader
        title="Edit series"
        subtitle={`Posting to ${group.name}`}
        backHref={groupPath(group.id, "/settings/lectures/series")}
        backLabel="Back to Series"
      />
      {series ? <SeriesForm groupId={group.id} series={series} /> : <ErrorState thing="this series" />}
    </PageContainer>
  );
}
