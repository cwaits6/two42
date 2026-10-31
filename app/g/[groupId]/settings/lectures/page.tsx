import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SegmentedLinks } from "@/components/ui/segmented";
import { groupPath } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";
import { groupPageTitle } from "@/lib/pageTitle";

export const generateMetadata = groupPageTitle("Manage lectures");

type LectureRow = {
  id: string;
  title: string;
  lecture_date: string | null;
  summary: string | null;
  series_id: string | null;
  lecture_series: { name: string } | null;
};

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function needsSummary(l: { summary: string | null }): boolean {
  return !l.summary || l.summary.trim() === "";
}

export default async function ManageLecturesPage({
  params,
  searchParams,
}: {
  params: Promise<{ groupId: string }>;
  searchParams: Promise<{ filter?: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  const base = groupPath(group.id, "/settings/lectures");
  const { filter } = await searchParams;
  const isNeedsSummaryView = filter === "needs-summary";

  const supabase = await createClient();

  const { data: lecturesData, error: lecturesError } = await supabase
    .from("lectures")
    .select("id, title, lecture_date, summary, series_id, lecture_series(name)")
    .eq("group_id", group.id)
    .order("lecture_date", { ascending: false, nullsFirst: false });

  if (lecturesError) {
    throw new Error(`Failed to load lectures: ${lecturesError.message}`);
  }

  const allLectures = (lecturesData ?? []) as unknown as LectureRow[];
  const awaitingCount = allLectures.filter(needsSummary).length;

  // Compute auto week numbers per series (date asc)
  const weekMap = new Map<string, number>();
  const seriesIds = Array.from(
    new Set(allLectures.map((l) => l.series_id).filter((id): id is string => !!id))
  );
  for (const sid of seriesIds) {
    const sorted = allLectures
      .filter((l) => l.series_id === sid)
      .sort((a, b) => {
        if (a.lecture_date && b.lecture_date)
          return new Date(a.lecture_date).getTime() - new Date(b.lecture_date).getTime();
        return 0;
      });
    sorted.forEach((l, i) => weekMap.set(l.id, i + 1));
  }

  const lectures = isNeedsSummaryView
    ? allLectures.filter(needsSummary)
    : allLectures;

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="flex items-center justify-between mb-8 flex-wrap gap-3">
        <h1 className="text-3xl font-bold text-brand-primary-text">Lectures</h1>
        <Button nativeButton={false} render={<Link href={`${base}/new`} />}>
          Add lecture
        </Button>
      </div>

      <SegmentedLinks
        label="Lecture filter"
        className="mb-6"
        options={[
          { href: base, label: `All Lectures (${allLectures.length})`, current: !isNeedsSummaryView },
          {
            href: `${base}?filter=needs-summary`,
            current: isNeedsSummaryView,
            label: (
              <>
                Awaiting Summary
                {awaitingCount > 0 && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-sm font-bold ${
                      isNeedsSummaryView
                        ? "bg-background text-foreground"
                        : "bg-brand-accent text-foreground"
                    }`}
                  >
                    {awaitingCount}
                  </span>
                )}
              </>
            ),
          },
        ]}
      />

      <Card>
        <CardHeader>
          <CardTitle>
            {isNeedsSummaryView ? "Awaiting Summary" : "All Lectures"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-3 pr-4 font-semibold text-muted-foreground">Title</th>
                  <th className="pb-3 pr-4 font-semibold text-muted-foreground">Series</th>
                  <th className="pb-3 pr-4 font-semibold text-muted-foreground">Week</th>
                  <th className="pb-3 pr-4 font-semibold text-muted-foreground">Date</th>
                  <th className="pb-3 pr-4 font-semibold text-muted-foreground">Status</th>
                </tr>
              </thead>
              <tbody>
                {lectures.map((lecture) => {
                  const seriesName = lecture.lecture_series?.name ?? "—";
                  const week = weekMap.get(lecture.id);
                  const missingSummary = needsSummary(lecture);

                  return (
                    <tr
                      key={lecture.id}
                      className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors"
                    >
                      <td className="py-3 pr-4 font-medium">
                        <Link
                          href={`${base}/${lecture.id}/edit`}
                          className="text-foreground hover:text-brand-primary-text transition-colors"
                        >
                          {lecture.title}
                        </Link>
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">{seriesName}</td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {week ? `Week ${String(week).padStart(2, "0")}` : "—"}
                      </td>
                      <td className="py-3 pr-4 text-muted-foreground">
                        {lecture.lecture_date ? formatDate(lecture.lecture_date) : "—"}
                      </td>
                      <td className="py-3 pr-4">
                        {missingSummary ? (
                          <span className="inline-flex items-center text-base font-bold text-brand-accent-text uppercase tracking-[0.1em]">
                            Needs summary
                          </span>
                        ) : (
                          <span className="text-base text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {lectures.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                      {isNeedsSummaryView ? (
                        <>All caught up — every lecture has a summary.</>
                      ) : (
                        <>
                          No lectures yet.{" "}
                          <Link
                            href={`${base}/new`}
                            className="text-brand-primary-text hover:underline"
                          >
                            Add one →
                          </Link>
                        </>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <div className="mt-6">
        <Link
          href={`${base}/series`}
          className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          Manage Lecture Series →
        </Link>
      </div>
    </div>
  );
}
