import { redirect } from "next/navigation";
import { getPlatformAdmin } from "@/lib/platform-access";
import { createServiceClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { UsageLists, UsagePeriodLinks } from "@/components/analytics/UsageLists";
import { readUsageTotals, usagePeriod } from "@/lib/analytics/usage";
import { pageTitle } from "@/lib/pageTitle";
import { logError } from "@/lib/log";

export const generateMetadata = () => pageTitle("Usage");

export default async function PlatformOrganizationUsagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const user = await getPlatformAdmin();
  if (!user) redirect("/dashboard");

  const { id } = await params;
  const days = usagePeriod((await searchParams).days);
  const back = { backHref: `/platform/usage?days=${days}`, backLabel: "Back to usage" } as const;

  // organizations is the tenant root and takes .eq("id"); the totals are then
  // bound to that row's id on this BYPASSRLS client. See
  // docs/security/service-role-inventory.md.
  const service = await createServiceClient();
  const { data: org, error } = await service
    .from("organizations")
    .select("id, name")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    logError("Platform usage organization read failed", error, { route: "/platform/usage/[id]" });
    return (
      <PageContainer>
        <PageHeader title="Usage" {...back} />
        <ErrorState thing="this organization" />
      </PageContainer>
    );
  }
  if (!org) redirect("/platform/usage");

  const { data: rows, error: totalsError } = await readUsageTotals(service, org.id, days);
  if (totalsError) {
    logError("Platform usage totals read failed", totalsError, {
      route: "/platform/usage/[id]",
      ids: { org: org.id },
    });
  }

  return (
    <PageContainer>
      <PageHeader title={org.name} subtitle="Page views and errors in this organization." {...back} />
      <UsagePeriodLinks path={`/platform/usage/${org.id}`} days={days} />
      {totalsError ? <ErrorState thing="usage" /> : <UsageLists rows={rows} days={days} />}
    </PageContainer>
  );
}
