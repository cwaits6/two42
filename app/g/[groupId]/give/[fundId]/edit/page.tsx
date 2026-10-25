import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { siteConfig } from "@/lib/config";
import { FundForm } from "@/components/giving/FundForm";
import {
  givingStewardsCanManage,
  loadFundFormData,
} from "@/lib/giving/server";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";
import type { GivingFund, GivingFundMethod } from "@/lib/types";
import { getOptionalUser } from "@/lib/supabase/current-user";

export const metadata = { title: `Edit Fund | ${siteConfig.name}` };

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

  const [{ data: fund }, { data: methodRows }, stewardsCanManage] =
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
        .eq("group_id", group.id),
      givingStewardsCanManage(supabase, profile.org_id),
    ]);

  if (!fund) notFound();
  const canManage =
    isLeader || (stewardsCanManage && fund.steward_id === user.id);
  if (!canManage) redirect(giveHref);

  const { members } = await loadFundFormData(supabase, profile.org_id);

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <h1 className="text-3xl md:text-4xl font-bold text-brand-primary mb-10">
        Edit fund
      </h1>
      <FundForm
        fund={{ ...fund, methods: (methodRows ?? []) as GivingFundMethod[] }}
        members={members}
        currentUserId={user.id}
        isLeader={isLeader}
        groupId={group.id}
        groupName={group.name}
        backHref={isLeader ? groupPath(group.id, "/settings/giving") : giveHref}
      />
    </div>
  );
}
