import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { RotationForm } from "@/components/supperClub/RotationForm";
import { valuesFromRotation } from "@/lib/supperClub/rotationValues";
import { groupPath, isUuid } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";
import { createClient } from "@/lib/supabase/server";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { loadRotation, loadRotationTitles } from "../../../load";

export const generateMetadata = groupPageTitle("Edit rotation");

export default async function EditRotationPage({
  params,
}: {
  params: Promise<{ groupId: string; rotationId: string }>;
}) {
  const { groupId, rotationId } = await params;
  const group = await requireGroupLeader(groupId);
  if (!isUuid(rotationId)) notFound();
  const supabase = await createClient();
  const [read, titles] = await Promise.all([
    loadRotation(supabase, group.id, rotationId),
    loadRotationTitles(supabase, group.id, rotationId),
  ]);
  const back = { backHref: groupPath(group.id, `/supper-club/rotations/${rotationId}`), backLabel: "Back to the rotation" };
  if (!read) {
    return (
      <PageContainer size="reading">
        <PageHeader title="Edit rotation" {...back} />
        <ErrorState thing="this rotation" />
      </PageContainer>
    );
  }
  const { rotation } = read;
  if (!rotation || rotation.status === "ended") notFound();
  const locked = rotation.status === "published";
  return (
    <PageContainer size="reading">
      <PageHeader
        title="Edit rotation"
        subtitle={locked ? "Tables are published, so only the title, sign-up close date and what guests bring can change." : undefined}
        {...back}
      />
      <RotationForm
        groupId={group.id}
        zone={await getOrgTimeZone()}
        rotationId={rotation.id}
        initial={valuesFromRotation(rotation)}
        locked={locked}
        takenTitles={titles ?? []}
      />
    </PageContainer>
  );
}
