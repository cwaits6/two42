import Link from "next/link";
import { redirect } from "next/navigation";
import { getPlatformAdmin } from "@/lib/platform-access";
import { createServiceClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { UsageLists, UsagePeriodLinks } from "@/components/analytics/UsageLists";
import { readUsageTotals, sumUsage, usagePeriod } from "@/lib/analytics/usage";
import { pageTitle } from "@/lib/pageTitle";
import { logError } from "@/lib/log";

export const generateMetadata = () => pageTitle("Usage");

export default async function PlatformUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const user = await getPlatformAdmin();
  if (!user) redirect("/dashboard");

  const days = usagePeriod((await searchParams).days);
  const header = (
    <>
      <PageHeader title="Usage" subtitle="Page views and errors in every organization, added together." />
      <UsagePeriodLinks path="/platform/usage" days={days} />
    </>
  );

  const service = await createServiceClient();
  // org-anchor: organizations is the tenant root and carries no org_id column,
  // and adding up every tenant is the point of this page. getPlatformAdmin()
  // above is the authority boundary standing in for an org predicate here.
  // See docs/security/service-role-inventory.md.
  const { data: orgs, error } = await service.from("organizations").select("id, name").order("name");
  if (error) {
    logError("Platform usage organizations read failed", error, { route: "/platform/usage" });
    return (
      <PageContainer>
        {header}
        <ErrorState thing="organizations" />
      </PageContainer>
    );
  }

  const perChurch = await Promise.all(orgs.map((org) => readUsageTotals(service, org.id, days)));
  const failed = perChurch.findIndex((read) => read.error);
  if (failed !== -1) {
    logError("Platform usage totals read failed", perChurch[failed].error, {
      route: "/platform/usage",
      ids: { org: orgs[failed].id },
    });
  }

  return (
    <PageContainer>
      {header}
      {failed !== -1 ? (
        // A total missing a church would read as a smaller number, not a failure.
        <ErrorState thing="usage" />
      ) : (
        <UsageLists rows={sumUsage(perChurch.map((read) => read.data ?? []))} days={days} />
      )}
      <section>
        <h2 className="mb-3 text-xl font-bold text-foreground">Organizations</h2>
        <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
          {orgs.map((org) => (
            <li key={org.id} className="flex min-h-11 items-center px-5 py-3">
              <Link
                href={`/platform/usage/${org.id}?days=${days}`}
                className="inline-flex min-h-11 items-center text-lg font-medium text-brand-primary-text underline underline-offset-4 hover:text-foreground"
              >
                {org.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </PageContainer>
  );
}
