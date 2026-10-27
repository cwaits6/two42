import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { siteConfig } from "@/lib/config";
import { FundForm } from "@/components/giving/FundForm";
import {
  givingStewardsCanManage,
  loadFundFormData,
} from "@/lib/giving/server";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";
import { getOptionalUser } from "@/lib/supabase/current-user";

export const metadata = { title: `New Fund | ${siteConfig.name}` };

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

  const { members } = await loadFundFormData(supabase, profile.org_id);

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <h1 className="text-3xl md:text-4xl font-bold text-brand-primary-text mb-10">
        New Fund
      </h1>
      <FundForm
        fund={null}
        members={members}
        currentUserId={user.id}
        isLeader={isLeader}
        groupId={group.id}
        groupName={group.name}
        backHref={giveHref}
      />
    </div>
  );
}
