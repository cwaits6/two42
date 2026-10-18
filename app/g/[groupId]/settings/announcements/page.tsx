import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { groupPath } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";
import { siteConfig } from "@/lib/config";

export const metadata = { title: `Announcements | ${siteConfig.name}` };

type AnnouncementRow = {
  id: string;
  title: string;
  is_published: boolean;
  published_at: string | null;
  created_at: string;
};

function statusOf(a: AnnouncementRow, now: Date): "Draft" | "Scheduled" | "Published" {
  if (!a.is_published) return "Draft";
  if (a.published_at && new Date(a.published_at) > now) return "Scheduled";
  return "Published";
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default async function ManageAnnouncementsPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("announcements")
    .select("id, title, is_published, published_at, created_at")
    .eq("group_id", group.id)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load announcements: ${error.message}`);
  }

  const announcements = (data ?? []) as AnnouncementRow[];
  const now = new Date();
  const settingsHref = groupPath(group.id, "/settings/announcements");

  return (
    <PageContainer>
      <PageHeader
        title="Announcements"
        subtitle={`Drafts, scheduled and published announcements for ${group.name}.`}
        backHref={groupPath(group.id, "/settings")}
        backLabel="Back to group settings"
        actions={
          <Button
            nativeButton={false}
            render={<Link href={`${settingsHref}/new`} />}
            className="bg-brand-primary hover:bg-brand-primary/90 text-white"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            New announcement
          </Button>
        }
      />

      {announcements.length > 0 ? (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          {announcements.map((a) => {
            const status = statusOf(a, now);
            const when = status === "Draft" ? a.created_at : (a.published_at ?? a.created_at);
            return (
              <li key={a.id}>
                <Link
                  href={`${settingsHref}/${a.id}/edit`}
                  className="flex min-h-14 flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5 py-4 hover:bg-muted/50 transition-colors"
                >
                  <span className="text-lg font-medium text-foreground">{a.title}</span>
                  <span className="text-base text-muted-foreground">
                    {status} · {formatDate(when)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
          <p className="text-xl text-muted-foreground">No announcements yet.</p>
        </div>
      )}
    </PageContainer>
  );
}
