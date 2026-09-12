import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/config";
import { displayName } from "@/lib/names";
import { PAYMENT_METHODS } from "@/lib/giving/methods";
import { GivingSettings } from "@/components/giving/GivingSettings";
import { getGivingSettings } from "@/lib/giving/server";
import type { GivingFund, GivingFundMethod } from "@/lib/types";

export const metadata = { title: `Giving | Admin | ${siteConfig.name}` };

type FundRow = GivingFund & {
  steward: {
    first_name: string | null;
    last_name: string | null;
    preferred_name: string | null;
  } | null;
};

function statusLabel(fund: FundRow, today: string) {
  if (!fund.is_active) return { text: "Retired", live: false };
  if (fund.retire_on && fund.retire_on < today) {
    return { text: `Auto-retired ${fund.retire_on}`, live: false };
  }
  return { text: "Live", live: true };
}

export default async function AdminGivingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, org_id")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") redirect("/dashboard");

  const [{ data: fundRows }, { data: methodRows }, givingSettings] =
    await Promise.all([
      supabase
        .from("giving_funds")
        .select(
          "*, steward:profiles!giving_funds_steward_id_fkey(first_name, last_name, preferred_name)"
        )
        .order("is_active", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase.from("giving_fund_methods").select("fund_id, method"),
      getGivingSettings(supabase, profile.org_id),
    ]);

  const funds = (fundRows ?? []) as FundRow[];
  const methodsByFund = new Map<string, GivingFundMethod["method"][]>();
  for (const m of methodRows ?? []) {
    methodsByFund.set(m.fund_id, [
      ...(methodsByFund.get(m.fund_id) ?? []),
      m.method,
    ]);
  }
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="container mx-auto px-4 py-12 max-w-4xl">
      <div className="flex items-start justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-brand-primary mb-2">
            Giving
          </h1>
          <p className="text-lg text-muted-foreground">
            Manage the funds on the Give page.
          </p>
        </div>
        <Button
          nativeButton={false}
          render={<Link href="/give/new" />}
          className="shrink-0 bg-brand-primary hover:bg-brand-primary/90 text-white"
        >
          <Plus className="mr-1.5 h-4 w-4" />
          New fund
        </Button>
      </div>

      <div className="mb-8">
        <GivingSettings
          stewardsCanManage={givingSettings.stewardsCanManage}
          dashboardTile={givingSettings.dashboardTile}
        />
      </div>

      {funds.length > 0 ? (
        <div className="space-y-3">
          {funds.map((fund) => {
            const status = statusLabel(fund, today);
            const methods = methodsByFund.get(fund.id) ?? [];
            return (
              <div
                key={fund.id}
                className={`flex items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 ${
                  status.live ? "" : "opacity-60"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg font-semibold text-foreground">
                      {fund.name}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wide ${
                        status.live
                          ? "bg-brand-warm text-brand-primary"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {status.text}
                    </span>
                  </div>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {fund.steward ? displayName(fund.steward) : "(no steward)"}
                    {fund.steward_role ? ` · ${fund.steward_role}` : ""}
                    {fund.retire_on && status.live
                      ? ` · retires ${fund.retire_on}`
                      : ""}
                  </p>
                </div>
                <div className="hidden sm:flex gap-1.5">
                  {methods.map((key) => (
                    <span
                      key={key}
                      aria-label={PAYMENT_METHODS[key].name}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-xs font-bold text-white"
                      style={{ backgroundColor: PAYMENT_METHODS[key].color }}
                    >
                      {PAYMENT_METHODS[key].glyph}
                    </span>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="default"
                  nativeButton={false}
                  render={<Link href={`/give/${fund.id}/edit`} />}
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Edit
                </Button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-lg text-muted-foreground">
          No funds yet.
        </p>
      )}
    </div>
  );
}
