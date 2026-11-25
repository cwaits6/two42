import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { SeasonForm } from "@/components/dinnerClub/SeasonForm";
import { NEW_SEASON } from "@/lib/dinnerClub/seasonValues";
import { groupPath } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";
import { getOrgTimeZone } from "@/lib/time/orgZone";

export const generateMetadata = groupPageTitle("Add season");

export default async function NewSeasonPage({ params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  return (
    <PageContainer size="reading">
      <PageHeader
        title="Add season"
        subtitle="Set the dates, format and table size. Dinner dates are proposed from them."
        backHref={groupPath(group.id, "/dinner-club")}
        backLabel="Back to Dinner club"
      />
      <SeasonForm groupId={group.id} zone={await getOrgTimeZone()} initial={NEW_SEASON} />
    </PageContainer>
  );
}
