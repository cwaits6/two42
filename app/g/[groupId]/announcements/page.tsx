import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Megaphone, Plus } from "lucide-react";
import { AnnouncementCard } from "@/components/announcements/AnnouncementCard";
import { AnnouncementStatusBadge } from "@/components/announcements/AnnouncementStatusBadge";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { Button } from "@/components/ui/button";
import { announcementStatus } from "@/lib/announcements";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";
import { readList } from "@/lib/supabase/readList";
import { groupPageTitle } from "@/lib/pageTitle";
import { getOrgTimeZone } from "@/lib/time/orgZone";
import { formatInZone } from "@/lib/time/zone";

export const generateMetadata = groupPageTitle("Announcements");

type LeaderRow = {
  id: string;
  title: string;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
};

export default async function AnnouncementsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireActiveGroup(groupId);
  const isLeader = group.role === "leader";
  const listHref = groupPath(group.id, "/announcements");
  const supabase = await createClient();
  const now = new Date();
  const nowIso = now.toISOString();

  const [announcements, unpublished, timeZone] = await Promise.all([
    supabase
      .from("announcements")
      .select("*")
      .eq("group_id", group.id)
      .eq("is_published", true)
      .lte("published_at", nowIso)
      .order("published_at", { ascending: false })
      .then((read) => readList(read, "announcements")),
    isLeader
      ? supabase
          .from("announcements")
          .select("id, title, is_published, published_at, created_at")
          .eq("group_id", group.id)
          .or(`is_published.eq.false,published_at.gt.${nowIso}`)
          .order("created_at", { ascending: false })
          .then((read) => readList<LeaderRow>(read, "announcements"))
      : [],
    getOrgTimeZone(),
  ]);

  const addAnnouncement = isLeader && (
    <Button nativeButton={false} render={<Link href={`${listHref}/new`} />}>
      <Plus aria-hidden="true" />
      Add announcement
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Announcements"
        subtitle={`News and updates for ${group.name}.`}
        actions={addAnnouncement}
      />

      {announcements === null ? (
        <ErrorState thing="announcements" />
      ) : (
        <>
          {!unpublished ? (
            <ErrorState thing="drafts and scheduled announcements" className="mb-10" />
          ) : (
            unpublished.length > 0 && (
              <section aria-labelledby="unpublished-announcements" className="mb-10">
                <h2
                  id="unpublished-announcements"
                  className="mb-4 font-serif text-2xl font-medium text-foreground"
                >
                  Drafts and scheduled
                </h2>
                <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
                  {unpublished.map((a) => {
                    const status = announcementStatus(a, now);
                    const when = status === "Draft" ? a.created_at : (a.published_at ?? a.created_at);
                    return (
                      <li key={a.id}>
                        <Link
                          href={`${listHref}/${a.id}/edit`}
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
              </section>
            )
          )}
          {announcements.length > 0 ? (
            <div className="space-y-6">
              {announcements.map((announcement) => (
                <AnnouncementCard
                  key={announcement.id}
                  announcement={announcement}
                  timeZone={timeZone}
                  editHref={isLeader ? `${listHref}/${announcement.id}/edit` : undefined}
                />
              ))}
            </div>
          ) : (
            unpublished?.length === 0 && (
              <EmptyState icon={Megaphone} message="No announcements yet." action={addAnnouncement} />
            )
          )}
        </>
      )}
    </PageContainer>
  );
}
