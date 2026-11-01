import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
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
import type { GivingFund, GivingFundMethod } from "@/lib/types";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { groupPageTitle } from "@/lib/pageTitle";
import { readList } from "@/lib/supabase/readList";
import { todayIn } from "@/lib/serving/dates";
import { getOrgTimeZone } from "@/lib/time/orgZone";

export const generateMetadata = groupPageTitle("Edit fund");

export default async function EditFundPage({
  params,
}: {
  params: Promise<{ groupId: string; fundId: string }>;
}) {
  const { groupId, fundId } = await params;
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

  const [{ data: fund, error: fundError }, methods, stewardsCanManage, timeZone] =
    await Promise.all([
      supabase
        .from("giving_funds")
        .select("*")
        .eq("id", fundId)
        .eq("group_id", group.id)
        .maybeSingle<GivingFund>(),
      supabase
        .from("giving_fund_methods")
        .select("*")
        .eq("fund_id", fundId)
        .eq("group_id", group.id)
        .then((read) => readList<GivingFundMethod>(read, "fund payment methods")),
      givingStewardsCanManage(supabase, profile.org_id),
      getOrgTimeZone(),
    ]);

  if (fundError) {
    console.error("Failed to load the fund: code=%s message=%s", fundError.code, fundError.message);
  }
  if (!fund && !fundError) notFound();
  const canManage =
    isLeader || (stewardsCanManage && fund?.steward_id === user.id);
  if (fund && !canManage) redirect(giveHref);

  const { members, failed: membersFailed } = fund
    ? await loadFundFormData(supabase, profile.org_id)
    : { members: [], failed: false };
  const backHref = isLeader ? groupPath(group.id, "/settings/giving") : giveHref;

  return (
    <PageContainer>
      <PageHeader
        title="Edit fund"
        backHref={backHref}
        backLabel={isLeader ? "Back to Giving" : "Back to Give"}
      />
      {/* A partial read must not reach the form: saving prunes every method it doesn't show. */}
      {!fund || methods === null || membersFailed ? (
        <ErrorState thing="the fund" />
      ) : (
        <FundForm
          fund={{ ...fund, methods }}
          members={members}
          currentUserId={user.id}
          isLeader={isLeader}
          groupId={group.id}
          groupName={group.name}
          backHref={backHref}
          today={todayIn(timeZone)}
        />
      )}
    </PageContainer>
  );
}
