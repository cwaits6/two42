import Link from "next/link";
import { redirect } from "next/navigation";
import { getPlatformAdmin } from "@/lib/platform-access";
import { createServiceClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { Card, CardContent } from "@/components/ui/card";
import { pageTitle } from "@/lib/pageTitle";

export const generateMetadata = () => pageTitle("Platform overview");

const linkClass =
  "inline-flex min-h-11 items-center text-base font-semibold text-brand-primary-text underline underline-offset-4 hover:text-foreground";

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
        <PageHeader title="Overview" />
        <ErrorState thing="organization counts" />
      </PageContainer>
    );
  }

  const active = (orgs ?? []).filter((o) => o.status === "active").length;
  const suspended = (orgs ?? []).length - active;

  return (
    <PageContainer>
      <PageHeader title="Overview" />

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

      <nav aria-label="Platform shortcuts" className="mt-8 flex flex-wrap gap-x-6">
        <Link href="/platform/organizations" className={linkClass}>
          Manage organizations
        </Link>
        {/* The only way to the password form for an operator who belongs to
            no church: the account menu links to Settings for members only. */}
        <Link href="/settings" className={linkClass}>
          Change password or email
        </Link>
      </nav>
    </PageContainer>
  );
}
