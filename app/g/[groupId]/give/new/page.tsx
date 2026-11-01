import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { FundForm } from "@/components/giving/FundForm";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import {
  givingStewardsCanManage,
  loadFundFormData,
} from "@/lib/giving/server";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { groupPageTitle } from "@/lib/pageTitle";
import { todayIn } from "@/lib/serving/dates";
import { getOrgTimeZone } from "@/lib/time/orgZone";

export const generateMetadata = groupPageTitle("Add fund");

export default async function NewFundPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireActiveGroup(groupId);
  const giveHref = groupPath(group.id, "/give");
  const supabase = await createClient();
  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, org_id")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role === "pending") redirect("/dashboard");
  const isLeader = group.role === "leader";

  const stewardsCanManage = await givingStewardsCanManage(supabase, profile.org_id);
  if (!isLeader && !stewardsCanManage) redirect(giveHref);

  const [{ members, failed }, timeZone] = await Promise.all([
    loadFundFormData(supabase, profile.org_id),
    getOrgTimeZone(),
  ]);

  return (
    <PageContainer>
      <PageHeader title="Add fund" backHref={giveHref} backLabel="Back to Give" />
      {failed ? (
        <ErrorState thing="the fund form" />
      ) : (
        <FundForm
          fund={null}
          members={members}
          currentUserId={user.id}
          isLeader={isLeader}
          groupId={group.id}
          groupName={group.name}
          backHref={giveHref}
          today={todayIn(timeZone)}
        />
      )}
    </PageContainer>
  );
}
