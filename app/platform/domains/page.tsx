import { redirect } from "next/navigation";
import { getPlatformAdmin } from "@/lib/platform-access";
import { createServiceClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { DomainsList, type PlatformDomain } from "./DomainsList";

/**
 * Cross-tenant view of every claimed custom domain and its attachment
 * state: verified-but-unattached rows with their lease (not claimed / live /
 * expired), attached rows, and 'removing' tombstones the worker still owes
 * a Vercel detach. Observability plus a manual "clear expired claim" retry —
 * never a place that writes attached_at.
 */
export default async function PlatformDomainsPage() {
  const user = await getPlatformAdmin();
  if (!user) redirect("/dashboard");

  const service = await createServiceClient();
  // org-anchor: listing every tenant's domains is the whole point of this
  // surface, so there is no single org to predicate on. getPlatformAdmin()
  // above is the authority boundary standing in for an org predicate; the
  // organizations embed is an FK traversal from each org_domains row to the
  // tenant root. See docs/security/service-role-inventory.md.
  const { data: rows, error } = await service
    .from("org_domains")
    .select(
      "id, org_id, domain, status, verified_at, attached_at, attach_claimed_at, last_checked_at, created_at, organizations(name, slug)",
    )
    .order("created_at");

  if (error) {
    console.error("Platform domains list read failed", error);
    return (
      <PageContainer size="wide">
        <PageHeader title="Domains" />
        <p className="text-base">Could not load domains. Try again in a moment.</p>
      </PageContainer>
    );
  }

  // The organizations embed is many-to-one (org_domains.org_id → the tenant
  // root's PK), but the generated types cannot see the FK direction and
  // shape it as an array. Normalise to the single row the FK guarantees.
  const domains: PlatformDomain[] = (rows ?? []).map((row) => {
    const org = Array.isArray(row.organizations)
      ? (row.organizations[0] ?? null)
      : (row.organizations as PlatformDomain["organizations"]);
    return { ...row, organizations: org };
  });

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Domains"
        subtitle="Every claimed custom domain across organizations, with its attachment state."
      />
      <DomainsList initialRows={domains} />
    </PageContainer>
  );
}
