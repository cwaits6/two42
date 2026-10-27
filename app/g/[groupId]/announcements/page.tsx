import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Plus } from "lucide-react";
import { AnnouncementCard } from "@/components/announcements/AnnouncementCard";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/config";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";

export const metadata = { title: `Announcements | ${siteConfig.name}` };

export default async function AnnouncementsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireActiveGroup(groupId);
  const supabase = await createClient();

  const { data: announcements } = await supabase
    .from("announcements")
    .select("*")
    .eq("group_id", group.id)
    .eq("is_published", true)
    .lte("published_at", new Date().toISOString())
    .order("published_at", { ascending: false });

  return (
    <PageContainer>
      <PageHeader
        title="Announcements"
        subtitle="News and updates from our group."
      />

      {announcements && announcements.length > 0 ? (
        <div className="space-y-6">
          {announcements.map((announcement) => (
            <AnnouncementCard key={announcement.id} announcement={announcement} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
          <p className="text-xl text-muted-foreground">No announcements yet.</p>
          {group.role === "leader" && (
            <p className="mt-3">
              <Button
                nativeButton={false}
                render={<Link href={groupPath(group.id, "/settings/announcements/new")} />}
              >
                <Plus className="mr-1.5 h-4 w-4" />
                Create announcement
              </Button>
            </p>
          )}
        </div>
      )}
    </PageContainer>
  );
}
