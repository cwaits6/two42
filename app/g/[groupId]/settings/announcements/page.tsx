import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { AnnouncementStatusBadge } from "@/components/announcements/AnnouncementStatusBadge";
import { Button } from "@/components/ui/button";
import { announcementStatus } from "@/lib/announcements";
import { groupPath } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";
import { readList } from "@/lib/supabase/readList";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { formatInZone } from "@/lib/time/zone";

export const generateMetadata = groupPageTitle("Manage announcements");

type AnnouncementRow = {
  id: string;
  title: string;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
};

export default async function ManageAnnouncementsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  const supabase = await createClient();

  const [announcements, timeZone] = await Promise.all([
    supabase
      .from("announcements")
      .select("id, title, is_published, published_at, created_at")
      .eq("group_id", group.id)
      .order("created_at", { ascending: false })
      .then((read) => readList<AnnouncementRow>(read, "announcements")),
    getOrgTimeZone(),
  ]);
  const now = new Date();
  const base = groupPath(group.id, "/settings/announcements");

  const addAnnouncement = (
    <Button nativeButton={false} render={<Link href={`${base}/new`} />}>
      <Plus aria-hidden="true" />
      Add announcement
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Announcements"
        subtitle={`Drafts, scheduled and published announcements for ${group.name}.`}
        backHref={groupPath(group.id, "/settings")}
        backLabel="Back to Group settings"
        actions={addAnnouncement}
      />

      {announcements === null ? (
        <ErrorState thing="announcements" />
      ) : announcements.length === 0 ? (
        <EmptyState icon={Megaphone} message="No announcements yet." action={addAnnouncement} />
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          {announcements.map((a) => {
            const status = announcementStatus(a, now);
            const when = status === "Draft" ? a.created_at : (a.published_at ?? a.created_at);
            return (
              <li key={a.id}>
                <Link
                  href={`${base}/${a.id}/edit`}
                  className="flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-2 px-5 py-4 transition-colors hover:bg-muted/50"
                >
                  <span className="text-lg font-medium text-foreground">{a.title}</span>
                  <span className="flex items-center gap-3 text-base text-muted-foreground">
                    <AnnouncementStatusBadge status={status} />
                    {formatInZone(when, timeZone, { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </PageContainer>
  );
}
