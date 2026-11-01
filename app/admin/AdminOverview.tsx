import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/states/ErrorState";
import { createClient } from "@/lib/supabase/server";
import { pendingJoinRequestsSummary } from "@/lib/groups/joinQueue";
import { getPendingJoinRequests } from "@/lib/groups/pendingJoinRequests";
import { overviewNeeds } from "./overviewNeeds";

/** The church at a glance. Requests are reviewed on their own pages, so each has one home. */
export async function AdminOverview() {
  const supabase = await createClient();

  const [members, households, groups, accessRequests, groupRequests] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }).neq("role", "pending"),
    supabase.from("family_units").select("id", { count: "exact", head: true }),
    supabase.from("groups").select("id, name").order("name", { ascending: true }),
    supabase.from("access_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    supabase.from("group_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  const joinRequests = groups.data ? await getPendingJoinRequests(groups.data) : null;

  const failed = [members, households, groups, accessRequests, groupRequests].find((r) => r.error);
  if (failed || !joinRequests) {
    if (failed) console.error("Failed to load the overview:", failed.error?.code);
    return <ErrorState thing="the overview" />;
  }

  const counts = [
    { label: "Members", count: members.count ?? 0, href: "/admin/members", action: "View members" },
    { label: "Households", count: households.count ?? 0, href: "/admin/families", action: "View households" },
    { label: "Groups", count: groups.data?.length ?? 0, href: "/admin/groups", action: "View groups" },
  ];
  const needs = overviewNeeds({
    accessRequests: accessRequests.count ?? 0,
    groupRequests: groupRequests.count ?? 0,
    joinRequests: joinRequests.length,
    joinSummary: pendingJoinRequestsSummary(joinRequests.length),
  });

  return (
    <div className="space-y-10">
      <section aria-labelledby="overview-counts">
        <h2 id="overview-counts" className="sr-only">
          Your church
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          {counts.map((item) => (
            <Card key={item.href}>
              <CardContent className="space-y-3">
                <p className="text-lg text-muted-foreground">{item.label}</p>
                <p className="font-serif text-4xl font-medium text-foreground">{item.count}</p>
                <Button
                  variant="outline"
                  className="w-full"
                  nativeButton={false}
                  render={<Link href={item.href} />}
                >
                  {item.action}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-bold text-brand-primary-text">Needs attention</h2>
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          {needs.map((need) => (
            <li
              key={need.title}
              className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-xl font-semibold">{need.title}</p>
                <p className="text-lg text-muted-foreground">{need.summary}</p>
              </div>
              {need.action && (
                <Button
                  variant="outline"
                  className="w-full shrink-0 sm:w-auto"
                  nativeButton={false}
                  render={<Link href={need.action.href} />}
                >
                  {need.action.label}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-bold text-brand-primary-text">Next steps</h2>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Button variant="outline" nativeButton={false} render={<Link href="/admin/members/invite" />}>
            Invite member
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link href="/admin/invite" />}>
            Import members
          </Button>
          <Button variant="outline" nativeButton={false} render={<Link href="/admin/settings" />}>
            Open church settings
          </Button>
        </div>
      </section>
    </div>
  );
}
