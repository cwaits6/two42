import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { groupPath } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";
import { SeriesForm } from "../SeriesForm";

export const generateMetadata = groupPageTitle("Add series");

export default async function NewSeriesPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  return (
    <PageContainer size="reading">
      <PageHeader
        title="Add series"
        subtitle={`Posting to ${group.name}`}
        backHref={groupPath(group.id, "/settings/lectures/series")}
        backLabel="Back to Series"
      />
      <SeriesForm groupId={group.id} />
    </PageContainer>
  );
}
