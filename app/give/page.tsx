import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { siteConfig } from "@/lib/config";
import { displayName, initials } from "@/lib/names";
import { resolveFundMethods } from "@/lib/giving/methods";
import { signStewardAvatars } from "@/lib/giving/server";
import { GiveList, type FundView } from "@/components/giving/GiveList";
import type { GivingFund, GivingFundMethod } from "@/lib/types";

export const metadata = { title: `Give | ${siteConfig.name}` };

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

function retireTag(retireOn: string | null): string | null {
  if (!retireOn) return null;
  const date = new Date(retireOn + "T00:00:00Z");
  return `Through ${date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })}`;
}

function stewardPerson(p: StewardInfo) {
  return { name: displayName(p), initials: initials(p), avatarUrl: p.avatar_url };
}

export default async function GivePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role === "pending") redirect("/dashboard");
  const isAdmin = profile.role === "admin";

  const today = new Date().toISOString().slice(0, 10);

  const [{ data: fundRows }, { data: modeRow }] = await Promise.all([
    supabase
      .from("giving_funds")
      .select(
        `*,
        steward:profiles!giving_funds_steward_id_fkey(id, first_name, last_name, preferred_name, avatar_url),
        co_steward:profiles!giving_funds_co_steward_id_fkey(id, first_name, last_name, preferred_name, avatar_url)`
      )
      .eq("is_active", true)
      .or(`retire_on.is.null,retire_on.gte.${today}`)
      .order("display_order")
      .order("created_at"),
    supabase
      .from("site_settings")
      .select("value")
      .eq("key", "giving_manage_mode")
      .maybeSingle(),
  ]);

  const rawFunds = (fundRows ?? []) as FundWithStewards[];
  // Private buckets (CWA-59): exchange steward avatar URLs for signed URLs
  // before they reach GiveList's renders.
  const funds = await signStewardAvatars(rawFunds);
  const stewardsCanManage = (modeRow?.value ?? "stewards") === "stewards";
  const canCreate = isAdmin || stewardsCanManage;

  let methods: GivingFundMethod[] = [];
  if (funds.length > 0) {
    const { data: methodRows } = await supabase
      .from("giving_fund_methods")
      .select("*")
      .in(
        "fund_id",
        funds.map((f) => f.id)
      );
    methods = (methodRows ?? []) as GivingFundMethod[];
  }

  const views: FundView[] = funds.flatMap((fund) => {
    if (!fund.steward) return [];
    const canManage =
      isAdmin || (stewardsCanManage && fund.steward_id === user.id);
    const resolved = resolveFundMethods(
      methods.filter((m) => m.fund_id === fund.id)
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
        tag: retireTag(fund.retire_on),
        stewards,
        stewardNames,
        role: fund.steward_role,
        methods: resolved,
        canManage,
      },
    ];
  });

  return (
    <PageContainer>
      <PageHeader
        title="Give"
        actions={
          canCreate && (
            <Button
              nativeButton={false}
              render={<Link href="/give/new" />}
              className="bg-brand-primary hover:bg-brand-primary/90 text-white"
            >
              <Plus className="mr-1.5 h-4 w-4" />
              Add fund
            </Button>
          )
        }
      />

      {views.length > 0 ? (
        <GiveList funds={views} />
      ) : (
        <div className="rounded-2xl border border-dashed border-border px-6 py-12 text-center">
          <p className="text-xl text-muted-foreground">No funds yet.</p>
          {canCreate && (
            <p className="mt-2 text-muted-foreground">
              <Link
                href="/give/new"
                className="font-semibold text-brand-primary hover:underline"
              >
                Add the first fund
              </Link>
            </p>
          )}
        </div>
      )}
    </PageContainer>
  );
}
