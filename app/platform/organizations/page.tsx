import { redirect } from "next/navigation";
import { getPlatformAdmin } from "@/lib/platform-access";
import { createServiceClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { OrganizationsList, type PlatformOrg } from "./OrganizationsList";

export default async function PlatformOrganizationsPage() {
  const user = await getPlatformAdmin();
  if (!user) redirect("/dashboard");

  const service = await createServiceClient();
  // org-anchor: organizations is the tenant root and carries no org_id column,
  // and listing every tenant is the whole point of this surface.
  // getPlatformAdmin() above is the authority boundary standing in for an org
  // predicate here. See docs/security/service-role-inventory.md.
  const { data: orgs, error } = await service
    .from("organizations")
    .select("id, name, status, created_at")
    .order("name")
    .order("created_at");

  // Without this, a failed read is indistinguishable from an empty
  // deployment: orgs is null and the list renders "No organizations yet."
  // There is no error boundary in app/, so render the failure rather than
  // throwing into Next's default error page.
  if (error) {
    console.error("Platform organizations list read failed", error);
    return (
      <PageContainer size="wide">
        <PageHeader title="Organizations" />
        <p className="text-base">
          Could not load organizations. Try again in a moment.
        </p>
      </PageContainer>
    );
  }

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Organizations"
        subtitle="Every organization on this deployment."
      />
      <OrganizationsList initialOrgs={(orgs ?? []) as PlatformOrg[]} />
    </PageContainer>
  );
}
