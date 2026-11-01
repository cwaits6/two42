import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { HandCoins, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { displayName, initials } from "@/lib/names";
import { fundThroughTag } from "@/lib/giving/funds";
import { resolveFundMethods } from "@/lib/giving/methods";
import { signStewardAvatars } from "@/lib/giving/server";
import { GiveList, type FundView } from "@/components/giving/GiveList";
import { groupPath } from "@/lib/groups/active";
import { requireActiveGroup } from "@/lib/groups/server";
import type { GivingFund, GivingFundMethod } from "@/lib/types";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { groupPageTitle } from "@/lib/pageTitle";
import { todayIn } from "@/lib/serving/dates";
import { readList } from "@/lib/supabase/readList";
import { getOrgTimeZone } from "@/lib/time/orgZone";

export const generateMetadata = groupPageTitle("Give");

type StewardInfo = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  avatar_url: string | null;
};

type FundWithStewards = GivingFund & {
  steward: StewardInfo | null;
  co_steward: StewardInfo | null;
};

function stewardPerson(p: StewardInfo) {
  return { name: displayName(p), initials: initials(p), avatarUrl: p.avatar_url };
}

export default async function GivePage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireActiveGroup(groupId);
  const newFundHref = groupPath(group.id, "/give/new");
  const supabase = await createClient();
  const user = await getOptionalUser();
  if (!user) redirect("/login");

  const isLeader = group.role === "leader";

  const today = todayIn(await getOrgTimeZone());

  const [fundRows, { data: modeRow }] = await Promise.all([
    supabase
      .from("giving_funds")
      .select(
        `*,
        steward:profiles!giving_funds_steward_id_fkey(id, first_name, last_name, preferred_name, avatar_url),
        co_steward:profiles!giving_funds_co_steward_id_fkey(id, first_name, last_name, preferred_name, avatar_url)`
      )
      .eq("group_id", group.id)
      .eq("is_active", true)
      .or(`retire_on.is.null,retire_on.gte.${today}`)
      .order("display_order")
      .order("created_at")
      .then((read) => readList<FundWithStewards>(read, "funds")),
    supabase
      .from("site_settings")
      .select("value")
      .eq("key", "giving_manage_mode")
      .maybeSingle(),
  ]);

  // Private buckets: exchange steward avatar URLs for signed URLs
  // before they reach GiveList's renders.
  const funds = await signStewardAvatars(fundRows ?? []);
  const stewardsCanManage = (modeRow?.value ?? "stewards") === "stewards";
  const canCreate = isLeader || stewardsCanManage;

  const methods =
    funds.length > 0
      ? readList<GivingFundMethod>(
          await supabase
            .from("giving_fund_methods")
            .select("*")
            .eq("group_id", group.id)
            .in(
              "fund_id",
              funds.map((f) => f.id)
            ),
          "fund payment methods"
        )
      : [];

  const views: FundView[] = funds.flatMap((fund) => {
    if (!fund.steward) return [];
    const canManage =
      isLeader || (stewardsCanManage && fund.steward_id === user.id);
    const resolved = resolveFundMethods(
      (methods ?? []).filter((m) => m.fund_id === fund.id)
    );
    // A fund nobody can pay yet is only useful to whoever can fix it
    if (resolved.length === 0 && !canManage) return [];

    const stewards = [stewardPerson(fund.steward)];
    let stewardNames = stewards[0].name;
    if (fund.co_steward) {
      stewards.push(stewardPerson(fund.co_steward));
      const first =
        fund.steward.preferred_name?.trim() ||
        fund.steward.first_name?.trim() ||
        stewards[0].name;
      stewardNames = `${first} & ${stewards[1].name}`;
    }

    return [
      {
        id: fund.id,
        name: fund.name,
        description: fund.description,
        tag: fundThroughTag(fund.retire_on),
        stewards,
        stewardNames,
        role: fund.steward_role,
        methods: resolved,
        canManage,
      },
    ];
  });

  const addFund = canCreate && (
    <Button nativeButton={false} render={<Link href={newFundHref} />}>
      <Plus aria-hidden="true" />
      Add fund
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader title="Give" actions={addFund} />

      {fundRows === null || methods === null ? (
        <ErrorState thing="funds" />
      ) : views.length > 0 ? (
        <GiveList funds={views} groupId={group.id} />
      ) : (
        <EmptyState icon={HandCoins} message="No funds yet." action={addFund} />
      )}
    </PageContainer>
  );
}
