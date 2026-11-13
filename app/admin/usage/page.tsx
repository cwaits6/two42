import { Suspense } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { UsageLists, UsagePeriodLinks } from "@/components/analytics/UsageLists";
import { readUsageTotals, usagePeriod, type UsagePeriod } from "@/lib/analytics/usage";
import { resolveRequestOrgId } from "@/lib/org";
import { pageTitle } from "@/lib/pageTitle";
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";

export const generateMetadata = () => pageTitle("Usage");

// The layout has already turned away anyone who isn't a church admin.
async function ChurchUsage({ days }: { days: UsagePeriod }) {
  const supabase = await createClient();
  const orgId = await resolveRequestOrgId(supabase, { label: "usage page" });
  if (!orgId) return <ErrorState thing="usage" />;
  const { data: rows, error } = await readUsageTotals(supabase, orgId, days);
  if (error) {
    logError("Usage totals read failed", error, { route: "/admin/usage", ids: { org: orgId } });
    return <ErrorState thing="usage" />;
  }
  return <UsageLists rows={rows} days={days} />;
}

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const days = usagePeriod((await searchParams).days);
  return (
    <PageContainer>
      <PageHeader
        title="Usage"
        subtitle="How often each page was opened across the whole church. Counts under 5 show as fewer than 5."
      />
      <UsagePeriodLinks path="/admin/usage" days={days} />
      <Suspense key={days} fallback={<LoadingState thing="usage" />}>
        <ChurchUsage days={days} />
      </Suspense>
    </PageContainer>
  );
}
