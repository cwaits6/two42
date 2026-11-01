import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { HandCoins, Pencil, Plus } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/states/EmptyState";
import { ErrorState } from "@/components/states/ErrorState";
import { Button } from "@/components/ui/button";
import { displayName } from "@/lib/names";
import {
  formatFundDate,
  fundRecipientLine,
  fundStatus,
} from "@/lib/giving/funds";
import { METHOD_ORDER, PAYMENT_METHODS } from "@/lib/giving/methods";
import { groupPath } from "@/lib/groups/active";
import { requireGroupLeader } from "@/lib/groups/server";
import type { GivingFund, GivingFundMethod } from "@/lib/types";
import { groupPageTitle } from "@/lib/pageTitle";
import { todayIn } from "@/lib/serving/dates";
import { readList } from "@/lib/supabase/readList";
import { getOrgTimeZone } from "@/lib/time/orgZone";

export const generateMetadata = groupPageTitle("Giving settings");

type FundRow = GivingFund & {
  steward: {
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
  } | null;
};

export default async function GroupGivingPage({
  params,
}: {
  params: Promise<{ groupId: string }>;
}) {
  const { groupId } = await params;
  const group = await requireGroupLeader(groupId);
  const supabase = await createClient();

  const [funds, methodRows, timeZone] = await Promise.all([
    supabase
      .from("giving_funds")
      .select(
        "*, steward:profiles!giving_funds_steward_id_fkey(first_name, last_name, preferred_name)"
      )
      .eq("group_id", group.id)
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false })
      .then((read) => readList<FundRow>(read, "funds")),
    supabase
      .from("giving_fund_methods")
      .select("fund_id, method")
      .eq("group_id", group.id)
      .then((read) =>
        readList<Pick<GivingFundMethod, "fund_id" | "method">>(read, "fund payment methods")
      ),
    getOrgTimeZone(),
  ]);

  const today = todayIn(timeZone);

  const addFund = (
    <Button nativeButton={false} render={<Link href={groupPath(group.id, "/give/new")} />}>
      <Plus aria-hidden="true" />
      Add fund
    </Button>
  );

  return (
    <PageContainer>
      <PageHeader
        title="Giving"
        subtitle="Manage the funds on the Give page."
        backHref={groupPath(group.id, "/settings")}
        backLabel="Back to Group settings"
        actions={addFund}
      />

      {funds === null || methodRows === null ? (
        <ErrorState thing="funds" />
      ) : funds.length === 0 ? (
        <EmptyState icon={HandCoins} message="No funds yet." action={addFund} />
      ) : (
        <div className="space-y-3">
          {funds.map((fund) => {
            const status = fundStatus(fund, today);
            const methods = METHOD_ORDER.filter((key) =>
              methodRows.some((m) => m.fund_id === fund.id && m.method === key)
            );
            return (
              <div
                key={fund.id}
                className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-5 py-4 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-semibold text-foreground">
                      {fund.name}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-sm font-semibold ${
                        status.live
                          ? "bg-brand-warm text-brand-primary-text"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {status.text}
                    </span>
                  </div>
                  <p className="mt-1 text-base text-muted-foreground">
                    {fund.steward
                      ? fundRecipientLine(displayName(fund.steward), fund.steward_role)
                      : "No one named to receive it"}
                  </p>
                  {fund.retire_on && status.live && (
                    <p className="text-base text-muted-foreground">
                      Retires {formatFundDate(fund.retire_on)}
                    </p>
                  )}
                  <p className="text-base text-muted-foreground">
                    {methods.length > 0
                      ? methods.map((key) => PAYMENT_METHODS[key].name).join(", ")
                      : "No payment methods"}
                  </p>
                </div>
                <Button
                  variant="outline"
                  nativeButton={false}
                  render={<Link href={groupPath(group.id, `/give/${fund.id}/edit`)} />}
                  aria-label={`Edit ${fund.name}`}
                >
                  <Pencil aria-hidden="true" />
                  Edit
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}
