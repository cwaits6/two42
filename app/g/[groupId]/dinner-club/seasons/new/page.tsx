import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { SeasonForm } from "@/components/dinnerClub/SeasonForm";
import { NEW_SEASON, nextSeasonValues } from "@/lib/dinnerClub/seasonValues";
import { groupPath, isUuid } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";
import { createClient } from "@/lib/supabase/server";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { loadSeason } from "../../load";

export const generateMetadata = groupPageTitle("Add season");

export default async function NewSeasonPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { groupId } = await params;
  const { from } = await searchParams;
  const group = await requireGroupLeader(groupId);
  // Start next season: an ended season of this group lends its settings. Any
  // other value, or a failed read, gives the plain form.
  const read = typeof from === "string" && isUuid(from) ? await loadSeason(await createClient(), group.id, from) : null;
  const previous = read?.season?.status === "ended" ? read.season : null;
  return (
    <PageContainer size="reading">
      <PageHeader
        title="Add season"
        subtitle={
          previous
            ? `Starts from ${previous.title}: the same format and settings. Its parties are asked to sign up again.`
            : "Set the dates, format and table size. Dinner dates are proposed from them."
        }
        backHref={groupPath(group.id, "/dinner-club")}
        backLabel="Back to Dinner club"
      />
      <SeasonForm
        groupId={group.id}
        zone={await getOrgTimeZone()}
        initial={previous ? nextSeasonValues(previous) : NEW_SEASON}
        previousSeasonId={previous?.id}
      />
    </PageContainer>
  );
}
