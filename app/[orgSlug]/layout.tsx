import { isValidOrgSlug } from "@/lib/org";
import { assertPathOrgMatchesHost } from "@/lib/supabase/server";
import { getOrgBranding } from "@/lib/branding";

// Org-scoped subtree branding. The root layout (app/layout.tsx) never
// resolves a specific org's branding for an anonymous request — this layout
// is the one place that does, and only because the URL itself names the org
// (the path param), not because of the request host. Every current and
// future /[orgSlug]/** route (e.g. /[orgSlug]/join) picks up its org's
// accent color from here without fetching branding itself.
export default async function OrgSlugLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;

  // Shape-check before the slug reaches an HTTP header, same as the join
  // page: a malformed slug never resolves an org, so there is nothing to
  // theme — the page itself renders its own unavailable state.
  if (!isValidOrgSlug(orgSlug)) {
    return <>{children}</>;
  }

  // Host-first precedence, same guard the org join page already applies —
  // defense in depth so a future /[orgSlug]/** route can't skip it.
  await assertPathOrgMatchesHost(orgSlug);

  const branding = await getOrgBranding(orgSlug);

  // These override the root layout's :root values for everything under this
  // subtree; the shadcn tokens are runtime custom properties, so nested
  // overrides inherit without touching the root <style> block.
  return (
    <div
      style={
        {
          "--color-brand-primary": branding.accent,
          "--primary": branding.accent,
          "--ring": branding.accent,
          "--sidebar-primary": branding.accent,
          "--sidebar-ring": branding.accent,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}
