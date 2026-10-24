import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { AdminCreateGroupButton } from "@/components/admin/AdminCreateGroupButton";
import { OrgGroupControls } from "@/components/admin/OrgGroupControls";
import { PendingGroupRequests } from "@/components/admin/PendingGroupRequests";
import { getGroupCreationPolicy } from "@/lib/groups/creationPolicy";
import { PENDING_GROUP_REQUEST_SELECT, toPendingGroupRequest } from "@/lib/groups/requests";
import { siteConfig } from "@/lib/config";

export const metadata = { title: `Groups | Admin | ${siteConfig.name}` };

export default async function AdminGroupsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, org_id")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") redirect("/dashboard");

  // The admin arms of the three SELECT policies return the whole org.
  const [policy, { data: requests, error: requestsError }, { data: groups, error: groupsError }] =
    await Promise.all([
      getGroupCreationPolicy(),
      supabase
        .from("group_requests")
        .select(PENDING_GROUP_REQUEST_SELECT)
        .eq("status", "pending")
        .order("created_at", { ascending: true }),
      supabase
        .from("groups")
        .select("id, name, description, group_members(count)")
        .order("name", { ascending: true }),
    ]);
  if (requestsError) console.error("Failed to load group requests:", requestsError);
  if (groupsError) console.error("Failed to load groups:", groupsError);

  const pending = (requests ?? []).map(toPendingGroupRequest);
  const groupRows = (groups ?? []).map((g) => ({
    id: g.id,
    name: g.name,
    description: g.description,
    memberCount: g.group_members[0]?.count ?? 0,
  }));

  return (
    <PageContainer size="wide">
      <PageHeader title="Groups" actions={<AdminCreateGroupButton />} />

      <section className="mb-10">
        <h2 className="mb-4 text-2xl font-bold text-brand-primary">Group settings</h2>
        <OrgGroupControls orgId={profile.org_id} policy={policy} />
      </section>

      <section className="mb-10">
        <h2 className="mb-4 text-2xl font-bold text-brand-primary">Pending group requests</h2>
        <PendingGroupRequests initialRequests={pending} />
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-bold text-brand-primary">Groups</h2>
        {groupRows.length === 0 ? (
          <p className="text-lg text-muted-foreground">No groups yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
            {groupRows.map((g) => (
              <li key={g.id} className="flex flex-col gap-1 px-5 py-4 sm:flex-row sm:items-baseline sm:justify-between">
                <div className="min-w-0">
                  <p className="text-xl font-semibold">{g.name}</p>
                  {g.description && (
                    <p className="text-base text-muted-foreground">{g.description}</p>
                  )}
                </div>
                <p className="shrink-0 text-base text-muted-foreground">
                  {g.memberCount} member{g.memberCount !== 1 ? "s" : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PageContainer>
  );
}
