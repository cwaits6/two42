import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { siteConfig } from "@/lib/config";
import { PendingRequestsList } from "./PendingRequestsList";
import { PendingGroupRequests } from "@/components/admin/PendingGroupRequests";
import { PENDING_GROUP_REQUEST_SELECT, toPendingGroupRequest } from "@/lib/groups/requests";
import { pendingJoinRequestsSummary } from "@/lib/groups/joinQueue";
import { getPendingJoinRequests } from "@/lib/groups/pendingJoinRequests";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { getOrgTimeZone } from "@/lib/time/orgZone";

export const metadata = { title: `Admin | ${siteConfig.name}` };

export default async function AdminPage() {
  const supabase = await createClient();
  const user = await getOptionalUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    redirect("/dashboard");
  }
  const timeZone = await getOrgTimeZone();

  const [pendingRequests, pendingGroupRequests, pendingJoinRequests] =
    await Promise.all([
      supabase
        .from("access_requests")
        .select("id, name, email, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .then(({ data }) => data ?? []),
      supabase
        .from("group_requests")
        .select(PENDING_GROUP_REQUEST_SELECT)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .then(({ data }) => (data ?? []).map(toPendingGroupRequest)),
      supabase
        .from("groups")
        .select("id, name")
        .order("name", { ascending: true })
        .then(({ data, error }) => {
          if (error) {
            console.error("Failed to load groups:", error);
            return null;
          }
          return getPendingJoinRequests(data ?? []);
        }),
    ]);

  const quickActions = [
    { href: "/admin/invite", label: "Invite member" },
    { href: "/admin/groups", label: "Manage groups" },
  ];

  return (
    <PageContainer size="wide">
      <PageHeader title="Admin" />

      <section className="mb-10">
        <h2 className="text-2xl font-bold text-brand-primary-text mb-4">
          Needs attention
        </h2>
        <h3 className="mb-3 text-xl font-semibold text-foreground">Access requests</h3>
        <PendingRequestsList initialRequests={pendingRequests} />
        <h3 className="mb-3 mt-8 text-xl font-semibold text-foreground">Group requests</h3>
        <PendingGroupRequests initialRequests={pendingGroupRequests} timeZone={timeZone} />
        <h3 className="mb-3 mt-8 text-xl font-semibold text-foreground">Join requests</h3>
        {pendingJoinRequests === null ? (
          <p role="alert" className="text-lg text-muted-foreground">
            Couldn&apos;t load the join requests. Reload the page to try again.
          </p>
        ) : (
          <>
            <p className="text-lg text-muted-foreground">
              {pendingJoinRequestsSummary(pendingJoinRequests.length)}
            </p>
            {pendingJoinRequests.length > 0 && (
              <Button
                size="lg"
                variant="outline"
                className="mt-3 text-lg"
                nativeButton={false}
                render={<Link href="/admin/groups" />}
              >
                Review join requests
              </Button>
            )}
          </>
        )}
      </section>

      <section>
        <h2 className="text-2xl font-bold text-brand-primary-text mb-4">
          Quick actions
        </h2>
        <div className="flex flex-wrap gap-3">
          {quickActions.map((action) => (
            <Button
              key={action.href}
              size="lg"
              variant="outline"
              className="text-lg"
              nativeButton={false}
              render={<Link href={action.href} />}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </section>
    </PageContainer>
  );
}
