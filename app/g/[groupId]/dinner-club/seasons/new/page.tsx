import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { SeasonForm } from "@/components/dinnerClub/SeasonForm";
import { ErrorState } from "@/components/states/ErrorState";
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
  // other value gives the plain form; a failed read must not, or the new
  // season would be saved unlinked from the one it continues.
  const fromId = typeof from === "string" && isUuid(from) ? from : null;
  const read = fromId ? await loadSeason(await createClient(), group.id, fromId) : null;
  const header = {
    title: "Add season",
    backHref: groupPath(group.id, "/dinner-club"),
    backLabel: "Back to Dinner club",
  };
  if (fromId && !read) {
    return (
      <PageContainer size="reading">
        <PageHeader {...header} />
        <ErrorState thing="the season to start from" />
      </PageContainer>
    );
  }
  const previous = read?.season?.status === "ended" ? read.season : null;
  return (
    <PageContainer size="reading">
      <PageHeader
        {...header}
        subtitle={
          previous
            ? `Starts from ${previous.title}: the same format and settings. Its parties are asked to sign up again.`
            : "Set the dates, format and table size. Dinner dates are proposed from them."
        }
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
