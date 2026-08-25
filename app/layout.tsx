import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Cormorant_Garamond, Inter_Tight, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AppShell } from "@/components/layout/AppShell";
import { SidebarProvider } from "@/components/layout/SidebarContext";
import { OrgSlugProvider } from "@/components/providers/OrgSlugProvider";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { resolveOrgSlug } from "@/lib/org";
import { siteConfig } from "@/lib/config";
import { getOrgBranding } from "@/lib/branding";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const interTight = Inter_Tight({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const b = await getOrgBranding();
  return {
    // No title.template: 25 pages already hardcode "| siteConfig.name" in
    // their static titles, and a template would double the suffix.
    title: b.display_name,
    description: siteConfig.description,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Skip the getUser() call entirely when there are no auth cookies.
  // This avoids noisy "Invalid Refresh Token" errors for unauthenticated visitors.
  const cookieStore = await cookies();
  // CSP allows inline scripts only with the per-request nonce
  const requestHeaders = await headers();
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  // Host-resolved org (Phase 5 PR 3, CWA-67) for client components via
  // OrgSlugProvider — same precedence as lib/supabase/server.ts.
  const orgSlug =
    requestHeaders.get("x-two42-resolved-org") ?? resolveOrgSlug();
  const hasAuthCookie = cookieStore.getAll().some((c) => c.name.includes("auth-token"));

  let profile = null;
  let hasServingAccess = false;
  let isPlatformAdmin = false;
  if (hasAuthCookie) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const [{ data, error }, { data: groupData, error: groupError }, { data: platformAdmin }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).single(),
        supabase.from("profile_groups").select("group_id").eq("profile_id", user.id),
        // Nav affordance only — every /platform surface re-checks
        // server-side; an RPC error just hides the link (fail closed).
        supabase.rpc("is_platform_admin"),
      ]);
      isPlatformAdmin = platformAdmin === true;
      // Neither failure can render an error page — the layout wraps every
      // route — but both degrade silently otherwise: a null profile renders
      // an authenticated member with the logged-out Header/AppShell, and a
      // null groupData silently denies serving access.
      if (error) console.error("Layout: failed to load profile:", error);
      if (groupError) console.error("Layout: failed to load profile groups:", groupError);
      profile = data;

      if (profile?.role === "admin") {
        hasServingAccess = true;
      } else if (groupData?.length) {
        const { count } = await supabase
          .from("serving_team_settings")
          .select("group_id", { count: "exact", head: true })
          .eq("enabled", true)
          .in("group_id", groupData.map((g) => g.group_id as string));
        hasServingAccess = (count ?? 0) > 0;
      }
    }
  }

  // Free on every path: generateMetadata() above already awaited this, and
  // cache() memoizes it for the request. Single-row read — RLS supplies the
  // id predicate, so there is deliberately no .eq() here (lib/branding.ts).
  const b = await getOrgBranding();

  return (
    // suppressHydrationWarning: the head script sets data-textsize on <html>
    // before React hydrates, and browsers mask script nonces so the client
    // always reads them as "" — both are expected mismatches.
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        {/* Apply saved display preferences before first paint */}
        <script
          nonce={nonce}
          suppressHydrationWarning
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("pref-textsize");if(t==="large"||t==="larger")document.documentElement.dataset.textsize=t}catch(e){}`,
          }}
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              :root {
                --color-brand-primary: ${b.accent};
                --color-brand-primary-light: ${siteConfig.colors.primaryLight};
                --color-brand-accent: ${siteConfig.colors.accent};
                --color-brand-warm: ${siteConfig.colors.warm};
                --color-brand-bg-light: ${siteConfig.colors.backgroundLight};
                --color-brand-bg-muted: ${siteConfig.colors.backgroundMuted};
                --primary: ${b.accent};
                --ring: ${b.accent};
                --sidebar-primary: ${b.accent};
                --sidebar-ring: ${b.accent};
              }
            `,
          }}
        />
      </head>
      <body className={`${cormorant.variable} ${interTight.variable} ${jetbrainsMono.variable} antialiased min-h-screen flex flex-col`}>
        <OrgSlugProvider orgSlug={orgSlug}>
          <SidebarProvider>
            <Header profile={profile} hasServingAccess={hasServingAccess} isPlatformAdmin={isPlatformAdmin} />
            <AppShell profile={profile} hasServingAccess={hasServingAccess}>{children}</AppShell>
          </SidebarProvider>
          <Footer />
          <Toaster />
          <Analytics />
          <SpeedInsights />
        </OrgSlugProvider>
      </body>
    </html>
  );
}
