import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { SeasonForm } from "@/components/dinnerClub/SeasonForm";
import { valuesFromSeason } from "@/lib/dinnerClub/seasonValues";
import { groupPath, isUuid } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";
import { createClient } from "@/lib/supabase/server";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { loadSeason } from "../../../load";

export const generateMetadata = groupPageTitle("Edit season");

export default async function EditSeasonPage({
  params,
}: {
  params: Promise<{ groupId: string; seasonId: string }>;
}) {
  const { groupId, seasonId } = await params;
  const group = await requireGroupLeader(groupId);
  if (!isUuid(seasonId)) notFound();
  const season = await loadSeason(await createClient(), group.id, seasonId);
  if (!season || season.status === "ended") notFound();
  const locked = season.status === "published";
  return (
    <PageContainer size="reading">
      <PageHeader
        title="Edit season"
        subtitle={locked ? "Tables are published, so only the title and sign-up close date can change." : undefined}
        backHref={groupPath(group.id, `/dinner-club/seasons/${season.id}`)}
        backLabel="Back to the season"
      />
      <SeasonForm
        groupId={group.id}
        zone={await getOrgTimeZone()}
        seasonId={season.id}
        initial={valuesFromSeason(season)}
        locked={locked}
      />
    </PageContainer>
  );
}
