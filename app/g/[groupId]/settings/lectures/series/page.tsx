import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { siteConfig } from "@/lib/config";
import { groupPath } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";

export const metadata = { title: `Lecture Series | Settings | ${siteConfig.name}` };

export default async function ManageSeriesPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  const base = groupPath(group.id, "/settings/lectures");
  const supabase = await createClient();

  const { data: series } = await supabase
    .from("lecture_series")
    .select("*, lectures(count)")
    .eq("group_id", group.id)
    .order("created_at", { ascending: false });

  return (
    <div className="container mx-auto px-4 py-12">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-brand-primary">Lecture Series</h1>
        <Button nativeButton={false} render={<Link href={`${base}/series/new`} />}>
          New series
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Series</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-base">
              <thead>
                <tr className="border-b border-border text-left">
                  <th className="pb-3 pr-4 font-semibold text-muted-foreground">Series</th>
                  <th className="pb-3 pr-4 font-semibold text-muted-foreground">Teacher</th>
                  <th className="pb-3 pr-4 font-semibold text-muted-foreground">Lectures</th>
                  <th className="pb-3 pr-4 font-semibold text-muted-foreground">Status</th>
                  <th className="pb-3 font-semibold text-muted-foreground"></th>
                </tr>
              </thead>
              <tbody>
                {(series ?? []).map((s) => {
                  const count = (s.lectures as unknown as Array<{ count: number }>)?.[0]?.count ?? 0;
                  return (
                    <tr key={s.id} className="border-b border-border last:border-0">
                      <td className="py-3 pr-4 font-medium text-foreground">{s.name}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{s.teacher ?? "—"}</td>
                      <td className="py-3 pr-4 text-muted-foreground">{count}</td>
                      <td className="py-3 pr-4">
                        {(s as unknown as { is_archived: boolean }).is_archived ? (
                          <span className="text-base font-medium text-muted-foreground">Archived</span>
                        ) : (
                          <span className="text-base font-medium text-green-700">Active</span>
                        )}
                      </td>
                      <td className="py-3">
                        <div className="flex items-center gap-4">
                          <Link
                            href={`${base}/new?series=${s.id}`}
                            className="text-brand-primary-text hover:underline font-medium text-base"
                          >
                            + Add lecture
                          </Link>
                          <Link
                            href={`${base}/series/${s.id}/edit`}
                            className="text-muted-foreground hover:underline font-medium text-base"
                          >
                            Edit
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {(!series || series.length === 0) && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-muted-foreground">
                      No series yet.{" "}
                      <Link href={`${base}/series/new`} className="text-brand-primary-text hover:underline">
                        Create one →
                      </Link>
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
          href={base}
          className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
        >
          ← Back to Lectures
        </Link>
      </div>
    </div>
  );
}
