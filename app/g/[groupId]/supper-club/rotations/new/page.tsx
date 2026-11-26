import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { RotationForm } from "@/components/supperClub/RotationForm";
import { ErrorState } from "@/components/states/ErrorState";
import { endsOnOf, NEW_ROTATION, nextRotationValues } from "@/lib/supperClub/rotationValues";
import { rotationTitle } from "@/lib/supperClub/rotationTitle";
import { groupPath, isUuid } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";
import { createClient } from "@/lib/supabase/server";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { loadRotation, loadRotationTitles } from "../../load";

export const generateMetadata = groupPageTitle("Add rotation");

export default async function NewRotationPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { groupId } = await params;
  const { from } = await searchParams;
  const group = await requireGroupLeader(groupId);
  // Start next rotation: an ended rotation of this group lends its settings. Any
  // other value gives the plain form; a failed read must not, or the new
  // rotation would be saved unlinked from the one it continues.
  const fromId = typeof from === "string" && isUuid(from) ? from : null;
  const supabase = await createClient();
  const [read, titles] = await Promise.all([
    fromId ? loadRotation(supabase, group.id, fromId) : null,
    loadRotationTitles(supabase, group.id),
  ]);
  // A title that clashes is only a suggestion the leader can change, so a
  // failed read still opens the form.
  const takenTitles = titles ?? [];
  const header = {
    title: "Add rotation",
    backHref: groupPath(group.id, "/supper-club"),
    backLabel: "Back to Supper club",
  };
  if (fromId && !read) {
    return (
      <PageContainer size="reading">
        <PageHeader {...header} />
        <ErrorState thing="the rotation to start from" />
      </PageContainer>
    );
  }
  const previous = read?.rotation?.status === "ended" ? read.rotation : null;
  const base = previous ? nextRotationValues(previous) : NEW_ROTATION;
  const initial = { ...base, title: rotationTitle(base.startsOn, endsOnOf(base), takenTitles) };
  return (
    <PageContainer size="reading">
      <PageHeader
        {...header}
        subtitle={
          previous
            ? `Starts from ${previous.title}: the same format and settings. Its parties are asked to sign up again.`
            : "Set the dates, format and table size. The title and supper dates are filled in from them."
        }
      />
      <RotationForm
        groupId={group.id}
        zone={await getOrgTimeZone()}
        initial={initial}
        previousRotationId={previous?.id}
        takenTitles={takenTitles}
      />
    </PageContainer>
  );
}
