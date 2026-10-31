import { redirect } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { createClient } from "@/lib/supabase/server";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { getDiscoveryOn } from "@/lib/groups/discovery";
import { greetingName } from "@/lib/groups/greeting";
import { getGroupMemberships } from "@/lib/groups/server";
import { GroupDashboard } from "@/components/groups/GroupDashboard";
import { HomeLauncher } from "@/components/groups/HomeLauncher";
import { NoGroupCard } from "@/components/groups/NoGroupCard";
import { pageTitle } from "@/lib/pageTitle";
import { SignOutButton } from "@/app/join/[token]/SignOutButton";

export const generateMetadata = () => pageTitle("Home");

// PostgREST's "no row" from .single(): the profile is missing, not unreadable.
const NO_ROW = "PGRST116";

// Home. A member of exactly one group is always inside it, so Home is that
// group's dashboard; two or more groups get the launcher; none get the
// no-group card.
export default async function DashboardPage() {
  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, org_id, preferred_name, first_name")
    .eq("id", user.id)
    .single();

  if (error && error.code !== NO_ROW) {
    console.error("Failed to load the viewer's profile: code=%s message=%s", error.code, error.message);
    return (
      <PageContainer>
        <PageHeader title="Home" />
        <ErrorState thing="Home" />
      </PageContainer>
    );
  }

  if (!profile || profile.role === "pending") {
    return (
      <PageContainer size="reading">
        <PageHeader
          title="Waiting for approval"
          subtitle="A church admin reviews your account. Once you are approved, your groups appear here."
        />
        <SignOutButton />
      </PageContainer>
    );
  }

  const [memberships, discoveryOn] = await Promise.all([getGroupMemberships(), getDiscoveryOn()]);

  if (memberships.length === 0) return <NoGroupCard discoveryOn={discoveryOn} />;
  if (memberships.length === 1) return <GroupDashboard group={memberships[0]} />;

  return (
    <HomeLauncher
      memberships={memberships}
      discoveryOn={discoveryOn}
      displayName={greetingName(profile)}
      orgId={profile.org_id}
    />
  );
}
