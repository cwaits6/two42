import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { AnnouncementCard } from "@/components/announcements/AnnouncementCard";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/config";
import { requireActiveGroup } from "@/lib/groups/server";

export const metadata = { title: `Announcements | ${siteConfig.name}` };

export default async function AnnouncementsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  await requireActiveGroup(groupId);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const isAdmin = profile?.role === "admin";

  const { data: announcements } = await supabase
    .from("announcements")
    .select("*")
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
          {isAdmin && (
            <p className="mt-3">
              <Button
                nativeButton={false}
                render={<Link href="/admin/announcements/new" />}
                className="bg-brand-primary hover:bg-brand-primary/90 text-white"
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
