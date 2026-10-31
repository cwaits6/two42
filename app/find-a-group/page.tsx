import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { CreateGroupAction } from "@/components/groups/CreateGroupAction";
import { FindAGroupList } from "@/components/groups/FindAGroupList";
import { ErrorState } from "@/components/states/ErrorState";
import { getDiscoverableGroups, getDiscoveryOn } from "@/lib/groups/discovery";
import { pageTitle } from "@/lib/pageTitle";

export const generateMetadata = () => pageTitle("Find a group");

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
        <ErrorState thing="groups to join" />
      ) : (
        <FindAGroupList initialRows={rows} />
      )}
    </PageContainer>
  );
}
