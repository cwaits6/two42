import Link from "next/link";
import { redirect } from "next/navigation";
import { getPlatformAdmin } from "@/lib/platform-access";
import { createServiceClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export default async function PlatformOverviewPage() {
  const user = await getPlatformAdmin();
  if (!user) redirect("/dashboard");

  const service = await createServiceClient();
  // org-anchor: organizations is the tenant root and carries no org_id column,
  // and counting every tenant is the whole point of the platform overview.
  // getPlatformAdmin() above is the authority boundary standing in for an org
  // predicate here. See docs/security/service-role-inventory.md.
  const { data: orgs, error } = await service.from("organizations").select("id, status");

  // A failed read would otherwise render a confident "0 active, 0 suspended"
  // — wrong lifecycle data is worse here than an explicit failure.
  if (error) {
    console.error("Platform overview organizations read failed", error);
    return (
      <PageContainer>
        <PageHeader title="Platform" />
        <p className="text-base">
          Could not load organization counts. Try again in a moment.
        </p>
      </PageContainer>
    );
  }

  const active = (orgs ?? []).filter((o) => o.status === "active").length;
  const suspended = (orgs ?? []).length - active;

  return (
    <PageContainer>
      <PageHeader title="Platform" subtitle="Create and manage organizations." />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="pt-6">
            <p className="text-4xl font-semibold">{active}</p>
            <p className="mt-1 text-base text-muted-foreground">Active organizations</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-4xl font-semibold">{suspended}</p>
            <p className="mt-1 text-base text-muted-foreground">Suspended organizations</p>
          </CardContent>
        </Card>
      </div>

      <p className="mt-8">
        <Link
          href="/platform/organizations"
          className="inline-flex min-h-11 items-center text-base font-semibold text-brand-primary-text underline underline-offset-4 hover:text-foreground"
        >
          Manage organizations
        </Link>
      </p>
    </PageContainer>
  );
}
