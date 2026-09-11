import { redirect } from "next/navigation";
import { getPlatformAdmin } from "@/lib/platform-access";
import { createServiceClient } from "@/lib/supabase/server";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { DEFAULT_DAILY_EMAIL_CAP } from "@/lib/email/quota";
import {
  OrganizationDetail,
  type EmailCapInfo,
  type EmailDomainInfo,
  type OrgDetail,
  type OwnerRequest,
} from "./OrganizationDetail";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function PlatformOrganizationPage({ params }: PageProps) {
  const user = await getPlatformAdmin();
  if (!user) redirect("/dashboard");

  const { id } = await params;

  // Cross-org reads: organizations is the tenant root and takes .eq("id");
  // access_requests is org-owned, so .eq("org_id", id) IS its tenant
  // boundary on this BYPASSRLS client. See
  // docs/security/service-role-inventory.md.
  const service = await createServiceClient();
  const { data: org, error: orgError } = await service
    .from("organizations")
    .select("id, name, slug, status, created_at, branding, custom_email_domain_enabled")
    .eq("id", id)
    .maybeSingle();

  // Distinguish "read failed" from "no such organization" — both leave org
  // null, but only the second should bounce to the list.
  if (orgError) {
    console.error("Platform organization detail read failed", orgError);
    return (
      <PageContainer>
        <PageHeader title="Organization" backHref="/platform/organizations" backLabel="Back to Organizations" />
        <p className="text-base">
          Could not load this organization. Try again in a moment.
        </p>
      </PageContainer>
    );
  }

  if (!org) redirect("/platform/organizations");

  const { data: ownerRequests, error: ownerError } = await service
    .from("access_requests")
    .select("name, email, signup_token, token_expires_at")
    .eq("org_id", id)
    .eq("approved_role", "admin")
    .order("created_at", { ascending: true })
    .limit(1);

  // A failed read here would render "No founding-admin request exists",
  // which could lead an operator to provision a second owner.
  if (ownerError) {
    console.error("Platform founding-admin read failed", ownerError);
    return (
      <PageContainer>
        <PageHeader title={org.name} subtitle={org.slug} backHref="/platform/organizations" backLabel="Back to Organizations" />
        <p className="text-base">
          Could not load the founding-admin request. Try again in a moment.
        </p>
      </PageContainer>
    );
  }

  // Email cap + today's usage + the org's sending-domain row. The cap tables
  // are service-role-only (no permissive policy) and the domain row is
  // scoped to the org's own admins, so these reads must run here;
  // .eq("org_id", org.id) is their tenant boundary on this BYPASSRLS client
  // — org.id, not the raw route param, so the anchor is the validated row.
  // Fail-soft: a failed read renders the card's unavailable state rather
  // than blocking the rest of the page — neither card is load-bearing for
  // the branding/lifecycle surfaces.
  const today = new Date().toISOString().slice(0, 10);
  const [
    { data: capRow, error: capError },
    { data: usageRow, error: usageError },
    { data: domainRow, error: domainError },
  ] = await Promise.all([
    service
      .from("org_email_limits")
      .select("daily_cap")
      .eq("org_id", org.id)
      .maybeSingle(),
    service
      .from("org_email_usage")
      .select("sent_count")
      .eq("org_id", org.id)
      .eq("usage_date", today)
      .maybeSingle(),
    service
      .from("org_email_domains")
      .select("domain, status, cleanup_failed_at")
      .eq("org_id", org.id)
      .maybeSingle(),
  ]);

  let emailCap: EmailCapInfo | null = null;
  if (capError || usageError) {
    console.error(
      "Platform email cap read failed for org %s:",
      id,
      { capError, usageError },
    );
  } else {
    emailCap = {
      dailyCap: capRow?.daily_cap ?? DEFAULT_DAILY_EMAIL_CAP,
      hasOverride: capRow !== null,
      usedToday: usageRow?.sent_count ?? 0,
    };
  }

  let emailDomain: EmailDomainInfo;
  if (domainError) {
    console.error("Platform email domain read failed for org %s:", id, domainError);
    emailDomain = { loaded: false };
  } else {
    emailDomain = {
      loaded: true,
      row: domainRow
        ? {
            domain: domainRow.domain,
            status: domainRow.status,
            cleanupFailedAt: domainRow.cleanup_failed_at,
          }
        : null,
    };
  }

  const ownerRow = ownerRequests?.[0] ?? null;
  const owner: OwnerRequest | null = ownerRow
    ? {
        name: ownerRow.name,
        email: ownerRow.email,
        inviteOutstanding: ownerRow.signup_token !== null,
        tokenExpiresAt: ownerRow.token_expires_at,
      }
    : null;

  const branding =
    typeof org.branding === "object" && org.branding !== null && !Array.isArray(org.branding)
      ? (org.branding as Record<string, unknown>)
      : {};

  const detail: OrgDetail = {
    id: org.id,
    name: org.name,
    slug: org.slug,
    status: org.status,
    customEmailDomainEnabled: org.custom_email_domain_enabled,
    branding: {
      display_name: typeof branding.display_name === "string" ? branding.display_name : "",
      logo_url: typeof branding.logo_url === "string" ? branding.logo_url : "",
      accent: typeof branding.accent === "string" ? branding.accent : "",
      reply_to: typeof branding.reply_to === "string" ? branding.reply_to : "",
    },
  };

  return (
    <PageContainer>
      <PageHeader
        title={org.name}
        subtitle={org.slug}
        backHref="/platform/organizations"
        backLabel="Back to Organizations"
      />
      <OrganizationDetail
        org={detail}
        owner={owner}
        emailCap={emailCap}
        emailDomain={emailDomain}
      />
    </PageContainer>
  );
}
