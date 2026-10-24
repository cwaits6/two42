import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { CreateGroupAction } from "@/components/groups/CreateGroupAction";
import { FindAGroupList, LOAD_FAILED_TEXT } from "@/components/groups/FindAGroupList";
import { getDiscoverableGroups, getDiscoveryOn } from "@/lib/groups/discovery";
import { siteConfig } from "@/lib/config";

export const metadata = { title: `Find a group | ${siteConfig.name}` };

// Renders only when the org has discovery on; discoverable_groups() decides
// which groups the viewer may see.
export default async function FindAGroupPage() {
  if (!(await getDiscoveryOn())) notFound();
  const rows = await getDiscoverableGroups();

  return (
    <PageContainer>
      <PageHeader title="Find a group" />
      <CreateGroupAction className="mb-6" />
      {rows === null ? (
        <p role="alert" className="text-lg text-muted-foreground">
          {LOAD_FAILED_TEXT}
        </p>
      ) : (
        <FindAGroupList initialRows={rows} />
      )}
    </PageContainer>
  );
}
