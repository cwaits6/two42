import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { groupPath } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";
import { createClient } from "@/lib/supabase/server";
import { GroupDetailsForm } from "./GroupDetailsForm";

export const generateMetadata = groupPageTitle("Name and description");

export default async function GroupDetailsSettingsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  const settingsHref = groupPath(group.id, "/settings");

  const supabase = await createClient();
  const { data: details, error } = await supabase
    .from("groups")
    .select("name, description")
    .eq("id", group.id)
    .maybeSingle();
  if (error) console.error("Failed to load the group's details: code=%s", error.code);

  return (
    <PageContainer size="reading">
      <PageHeader
        title="Name and description"
        subtitle="What members see on Home and in the switcher."
        backHref={settingsHref}
        backLabel="Back to Group settings"
      />
      {details ? (
        <GroupDetailsForm
          groupId={group.id}
          cancelHref={settingsHref}
          initialName={details.name}
          initialDescription={details.description}
        />
      ) : (
        <ErrorState thing="this group's details" />
      )}
    </PageContainer>
  );
}
