import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { siteConfig } from "@/lib/config";
import { isValidOrgSlug, resolveRequestOrgId } from "@/lib/org";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { assertPathOrgMatchesHost, createClient } from "@/lib/supabase/server";
import { JoinForm } from "@/app/join/JoinForm";
import { JoinUnavailable } from "@/app/join/JoinUnavailable";

interface PageProps {
  params: Promise<{ orgSlug: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { orgSlug } = await params;
  return {
    title: `Request Access | ${siteConfig.name}`,
    // Phase 5 §4: /[orgSlug]/join stays reachable, but the canonical URL is
    // the org's platform subdomain (custom domains land in Phase 5 PR 5,
    // once orgBaseUrl() exists). Skip the tag entirely for a malformed
    // slug — it would never be a valid canonical target anyway.
    alternates: isValidOrgSlug(orgSlug)
      ? { canonical: `https://${orgSlug}.${siteConfig.platformApex}/join` }
      : undefined,
  };
}

export default async function OrgJoinPage({ params }: PageProps) {
  const { orgSlug } = await params;

  // Signed-in members are already in an org — there's nothing to request, and
  // app_request_org_id() would ignore the slug and return their own org
  // anyway. Send them to the app before any resolution happens.
  if (await getOptionalUser()) {
    redirect("/dashboard");
  }

  // Shape-check before the slug reaches an HTTP header. Route params arrive
  // URL-decoded, so a %0d%0a payload would otherwise reach undici as a raw
  // header value and throw a 500 instead of taking the fail-closed path.
  // The pattern is the DB's own (provision_organization()), so anything it
  // rejects could never have been minted as an org slug.
  if (!isValidOrgSlug(orgSlug)) {
    console.error("Org join page: rejected malformed org slug %s", orgSlug);
    return <JoinUnavailable />;
  }

  // Host-first precedence (Phase 5 §5.3): if the host itself already named
  // a *different* org, this path slug never gets served — notFound() throws.
  // Unset host resolution (platform host, trusted fallback) is a no-op.
  await assertPathOrgMatchesHost(orgSlug);

  // The URL slug — not the host/env slug — is the org this request is about.
  // app_request_org_id() validates it against a real organizations row and
  // returns NULL otherwise, which is the fail-closed path below. It grants
  // nothing: the header only ever selects among orgs' already-public content.
  const supabase = await createClient(orgSlug);
  const orgId = await resolveRequestOrgId(supabase, {
    label: "Org join page",
    orgSlug,
  });

  // Both failure modes (RPC error, NULL result) land here. Never a fallback
  // org. The render is identical to the unresolvable-org case on purpose —
  // a distinct message would be an org-existence oracle.
  if (!orgId) {
    return <JoinUnavailable />;
  }

  return <JoinForm orgId={orgId} orgSlug={orgSlug} />;
}
