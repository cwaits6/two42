import Link from "next/link";
import { Layers, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { Button } from "@/components/ui/button";
import { groupPath } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";
import { readList } from "@/lib/supabase/readList";

export const generateMetadata = groupPageTitle("Manage series");

type SeriesRow = {
  id: string;
  name: string;
  teacher: string | null;
  is_archived: boolean;
  lectures: { count: number }[];
};

export default async function ManageSeriesPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  const base = groupPath(group.id, "/settings/lectures");
  const supabase = await createClient();

  const series = readList<SeriesRow>(
    await supabase
      .from("lecture_series")
      .select("id, name, teacher, is_archived, lectures(count)")
      .eq("group_id", group.id)
      .order("created_at", { ascending: false }),
    "lesson series",
  );

  const addSeries = (
    <Button nativeButton={false} render={<Link href={`${base}/series/new`} />}>
      <Plus aria-hidden="true" />
      Add series
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Series"
        subtitle="Lessons grouped under one title and teacher."
        backHref={base}
        backLabel="Back to Lessons"
        actions={addSeries}
      />

      {series === null ? (
        <ErrorState thing="series" />
      ) : series.length === 0 ? (
        <EmptyState icon={Layers} message="No series yet." action={addSeries} />
      ) : (
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          {series.map((s) => {
            const count = s.lectures[0]?.count ?? 0;
            const meta = [
              s.teacher,
              `${count} ${count === 1 ? "lesson" : "lessons"}`,
              s.is_archived ? "Past series" : "Current series",
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <li
                key={s.id}
                className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6"
              >
                <div className="min-w-0">
                  <p className="text-lg font-medium text-foreground">{s.name}</p>
                  <p className="text-base text-muted-foreground">{meta}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-3">
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={<Link href={`${base}/new?series=${s.id}`} />}
                    aria-label={`Add lesson to ${s.name}`}
                  >
                    Add lesson
                  </Button>
                  <Button
                    variant="outline"
                    nativeButton={false}
                    render={<Link href={`${base}/series/${s.id}/edit`} />}
                    aria-label={`Edit ${s.name}`}
                  >
                    Edit
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </PageContainer>
  );
}
