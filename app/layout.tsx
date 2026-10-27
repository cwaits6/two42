import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AppShell } from "@/components/layout/AppShell";
import { SidebarProvider } from "@/components/layout/SidebarContext";
import { GroupProvider } from "@/components/groups/GroupProvider";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { siteConfig } from "@/lib/config";
import { getRequestBranding } from "@/lib/branding";
import { getDiscoveryOn } from "@/lib/groups/discovery";
import { getGroupCreationPolicy } from "@/lib/groups/creationPolicy";
import { getGroupMemberships } from "@/lib/groups/server";
import type { ActiveGroup } from "@/lib/groups/active";
import type { GroupCreationPolicy } from "@/lib/groups/creation";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-serif",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const b = await getRequestBranding();
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
  // CSP allows inline scripts only with the per-request nonce
  const requestHeaders = await headers();
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  const user = await getOptionalUser();

  let profile = null;
  let hasServingAccess = false;
  let isPlatformAdmin = false;
  let memberships: ActiveGroup[] = [];
  let discoveryOn = false;
  let creationPolicy: GroupCreationPolicy = "approval";
  if (user) {
    const supabase = await createClient();
    const [{ data, error }, { data: groupData, error: groupError }, { data: platformAdmin }] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).single(),
      supabase.from("team_members").select("team_id").eq("profile_id", user.id),
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
    if (groupError) console.error("Layout: failed to load team memberships:", groupError);
    profile = data;

    const loadServingAccess = async () => {
      if (!groupData?.length) return false;
      const { count } = await supabase
        .from("serving_team_settings")
        .select("team_id", { count: "exact", head: true })
        .eq("enabled", true)
        .in("team_id", groupData.map((g) => g.team_id as string));
      return (count ?? 0) > 0;
    };
    // The layout has no error boundary of its own, so a failed membership
    // read hides the group nav and lets the page surface the error.
    const loadNavMemberships = () =>
      getGroupMemberships().catch((e: unknown) => {
        console.error("Layout: failed to load group memberships:", e);
        return [];
      });
    [hasServingAccess, memberships, discoveryOn, creationPolicy] = await Promise.all([
      loadServingAccess(),
      loadNavMemberships(),
      getDiscoveryOn(),
      getGroupCreationPolicy(),
    ]);
  }

  // Free on every path: generateMetadata() above already awaited this, and
  // cache() memoizes it for the request. Anonymous requests resolve no org,
  // so this renders the platform default unless the request is
  // authenticated (lib/branding.ts).
  const b = await getRequestBranding();

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
      <body className={`${fraunces.variable} ${inter.variable} ${jetbrainsMono.variable} antialiased min-h-screen flex flex-col`}>
        <GroupProvider
          memberships={memberships}
          discoveryOn={discoveryOn}
          creation={{ policy: creationPolicy, isOrgAdmin: profile?.role === "admin" }}
        >
          <SidebarProvider>
            <Header
              profile={profile}
              hasServingAccess={hasServingAccess}
              isPlatformAdmin={isPlatformAdmin}
              orgName={b.display_name}
            />
            <AppShell profile={profile} hasServingAccess={hasServingAccess} orgName={b.display_name}>
              {children}
            </AppShell>
          </SidebarProvider>
        </GroupProvider>
        <Footer />
        <Toaster />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
