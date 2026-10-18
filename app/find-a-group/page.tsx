import { notFound } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { getDiscoveryOn } from "@/lib/groups/discovery";
import { siteConfig } from "@/lib/config";

export const metadata = { title: `Find a group | ${siteConfig.name}` };

// Renders only when the org has discovery on; the discoverability ticket
// supplies the list of open groups.
export default async function FindAGroupPage() {
  if (!(await getDiscoveryOn())) notFound();

  return (
    <PageContainer>
      <PageHeader title="Find a group" />
      <p className="text-lg text-muted-foreground">No groups are open to join yet.</p>
    </PageContainer>
  );
}
