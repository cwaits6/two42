import { redirect } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { getDiscoveryOn } from "@/lib/groups/discovery";
import { getGroupMemberships } from "@/lib/groups/server";
import { GroupDashboard } from "@/components/groups/GroupDashboard";
import { HomeLauncher } from "@/components/groups/HomeLauncher";
import { NoGroupCard } from "@/components/groups/NoGroupCard";
import { siteConfig } from "@/lib/config";

export const metadata = { title: `Dashboard | ${siteConfig.name}` };

// Home. A member of exactly one group is always inside it, so Home is that
// group's dashboard; two or more groups get the launcher; none get the
// no-group card.
export default async function DashboardPage() {
  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, org_id, preferred_name, first_name")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role === "pending") {
    return (
      <div className="container mx-auto px-4 py-20 max-w-lg text-center">
        <Card className="p-8 border-border">
          <CardContent className="pt-6">
            <h1 className="font-serif text-3xl text-brand-primary mb-4">
              Pending Approval
            </h1>
            <p className="text-lg text-muted-foreground">
              Your account is waiting for admin approval. You&apos;ll receive an
              email once your access has been granted.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const [memberships, discoveryOn] = await Promise.all([getGroupMemberships(), getDiscoveryOn()]);

  if (memberships.length === 0) return <NoGroupCard discoveryOn={discoveryOn} />;
  if (memberships.length === 1) return <GroupDashboard group={memberships[0]} />;

  return (
    <HomeLauncher
      memberships={memberships}
      discoveryOn={discoveryOn}
      displayName={profile.preferred_name || profile.first_name || "Friend"}
      orgId={profile.org_id}
    />
  );
}
