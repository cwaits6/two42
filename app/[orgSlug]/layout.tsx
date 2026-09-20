import type { Metadata } from "next";
import { isValidOrgSlug } from "@/lib/org";
import { getOrgBranding } from "@/lib/branding";

interface OrgSlugLayoutProps {
  params: Promise<{ orgSlug: string }>;
}

// Slug-aware title for every /[orgSlug]/** route. The root layout's title has
// no org in it — it never resolves one for an anonymous request — so without
// this, every page under this subtree would inherit that generic title
// regardless of which org's join page it is. A child page sets a plain
// string title (e.g. "Request Access") and this template appends the org's
// name; a child with no title of its own falls back to `default`.
export async function generateMetadata({
  params,
}: OrgSlugLayoutProps): Promise<Metadata> {
  const { orgSlug } = await params;

  if (!isValidOrgSlug(orgSlug)) {
    return {};
  }

  const branding = await getOrgBranding(orgSlug);

  return {
    title: {
      template: `%s | ${branding.display_name}`,
      default: branding.display_name,
    },
  };
}

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

  const branding = await getOrgBranding(orgSlug);

  // These override the root layout's :root values for everything under this
  // subtree; the shadcn tokens are runtime custom properties, so nested
  // overrides inherit without touching the root <style> block. Header/Footer
  // render outside {children} (in the root layout), so they keep the
  // platform's colors here, not the org's.
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
