import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { groupPath } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { groupPageTitle } from "@/lib/pageTitle";
import { AnnouncementForm } from "../../AnnouncementForm";

export const generateMetadata = groupPageTitle("Edit announcement");

export default async function EditAnnouncementPage({
  params,
}: {
  params: Promise<{ groupId: string; id: string }>;
}) {
  const { groupId, id } = await params;
  const group = await requireGroupLeader(groupId);
  const supabase = await createClient();
  const [{ data, error }, timeZone] = await Promise.all([
    supabase
      .from("announcements")
      .select("*")
      .eq("id", id)
      .eq("group_id", group.id)
      .maybeSingle(),
    getOrgTimeZone(),
  ]);

  if (error) {
    console.error("Failed to load announcement %s: code=%s", id, error.code);
    return (
      <PageContainer size="reading">
        <PageHeader
          title="Edit announcement"
          backHref={groupPath(group.id, "/settings/announcements")}
          backLabel="Back to Announcements"
        />
        <ErrorState thing="the announcement" />
      </PageContainer>
    );
  }
  if (!data) notFound();

  return (
    <AnnouncementForm
      groupId={group.id}
      groupName={group.name}
      timeZone={timeZone}
      announcement={data}
    />
  );
}
