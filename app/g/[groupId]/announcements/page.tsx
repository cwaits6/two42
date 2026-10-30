import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import { AnnouncementCard } from "@/components/announcements/AnnouncementCard";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/config";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";
import { readList } from "@/lib/supabase/readList";

export const metadata = { title: `Announcements | ${siteConfig.name}` };

export default async function AnnouncementsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireActiveGroup(groupId);
  const supabase = await createClient();

  const announcements = readList(
    await supabase
      .from("announcements")
      .select("*")
      .eq("group_id", group.id)
      .eq("is_published", true)
      .lte("published_at", new Date().toISOString())
      .order("published_at", { ascending: false }),
    "announcements",
  );

  return (
    <PageContainer>
      <PageHeader
        title="Announcements"
        subtitle="News and updates from our group."
      />

      {announcements === null ? (
        <ErrorState thing="announcements" />
      ) : announcements.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          message="No announcements yet"
          action={
            group.role === "leader" && (
              <Button
                nativeButton={false}
                render={<Link href={groupPath(group.id, "/settings/announcements/new")} />}
              >
                <Plus />
                Add announcement
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-6">
          {announcements.map((announcement) => (
            <AnnouncementCard key={announcement.id} announcement={announcement} />
          ))}
        </div>
      )}
    </PageContainer>
  );
}
