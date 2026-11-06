import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminGroupList } from "@/components/admin/AdminGroupList";
import { listAdminGroups } from "@/components/admin/adminGroups";
import { ErrorState } from "@/components/states/ErrorState";
import { getGroupMemberships } from "@/lib/groups/server";
import { getOptionalUser } from "@/lib/supabase/current-user";

export async function AdminGroupsContent() {
  const supabase = await createClient();
  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") redirect("/dashboard");

  const [groupRows, memberships] = await Promise.all([
    // The admin arm of the SELECT policy returns the whole church.
    listAdminGroups(supabase),
    // Without these every row links to its admin page rather than failing all of Groups.
    getGroupMemberships().catch(() => []),
  ]);

  return groupRows ? (
    <AdminGroupList groups={groupRows} memberGroupIds={memberships.map((m) => m.id)} />
  ) : (
    <ErrorState thing="the groups" />
  );
}
