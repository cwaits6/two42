import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { AppShell } from "@/components/layout/AppShell";
import { SidebarProvider } from "@/components/layout/SidebarContext";
import { buildAccount } from "@/components/layout/account";
import { GroupProvider } from "@/components/groups/GroupProvider";
import { PageMeasurement } from "@/components/analytics/PageMeasurement";
import { UsageRecorder } from "@/components/analytics/UsageRecorder";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { siteConfig } from "@/lib/config";
import { getRequestBranding } from "@/lib/branding";
import { getDiscoveryOn } from "@/lib/groups/discovery";
import { getGroupCreationPolicy } from "@/lib/groups/creationPolicy";
import { getGroupMemberships } from "@/lib/groups/server";
import { getWaitingRequestCount } from "@/lib/admin/requestCounts";
import { getGroupWaitingRequestCounts } from "@/lib/groups/joinRequestCounts";
import { PROFILE_COLUMNS, type ProfileColumns } from "@/lib/profileColumns";
import { mintSignedUrl } from "@/lib/storageRead";
import type { ActiveGroup } from "@/lib/groups/active";
import type { GroupCreationPolicy } from "@/lib/groups/creation";
import "./globals.css";
import { logError } from "@/lib/log";

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

// resizes-content keeps a focused field, the block editor included, above
// the on-screen keyboard instead of letting the keyboard cover it.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  interactiveWidget: "resizes-content",
};

export async function generateMetadata(): Promise<Metadata> {
  const b = await getRequestBranding();
  return {
    // A fallback only: every page sets its whole title through pageTitle().
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
  let photoUrl: string | null = null;
  let waitingRequests: number | null = null;
  let groupWaitingRequests: Record<string, number> = {};
  if (user) {
    const supabase = await createClient();
    const [{ data, error }, { data: groupData, error: groupError }, { data: platformAdmin }] = await Promise.all([
      supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).maybeSingle<ProfileColumns>(),
      supabase.from("team_members").select("team_id").eq("profile_id", user.id),
      // Nav affordance only — every /platform surface re-checks
      // server-side; an RPC error just hides the link (fail closed).
      supabase.rpc("is_platform_admin"),
    ]);
    isPlatformAdmin = platformAdmin === true;
    // Neither failure can render an error page — the layout wraps every
    // route — but both degrade silently otherwise: a failed profile read
    // hides a member's nav, and a null groupData silently denies serving
    // access. No row is not an error: a platform admin has no profile.
    if (error) logError("Layout: failed to load profile", error);
    if (groupError) logError("Layout: failed to load team memberships", groupError);
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
        logError("Layout: failed to load group memberships", e);
        return [];
      });
    // Only a church admin's count is the whole church's; anyone else's would be a partial one.
    const loadWaitingRequests = () =>
      data?.role === "admin" ? getWaitingRequestCount().catch(() => null) : Promise.resolve(null);
    const membershipsLoad = loadNavMemberships();
    // Every group the viewer leads, not just the one in the address: the
    // layout does not re-run on client navigation between groups.
    const loadGroupWaitingRequests = () =>
      membershipsLoad
        .then((groups) => getGroupWaitingRequestCounts(groups.filter((g) => g.role === "leader").map((g) => g.id)))
        .catch((e: unknown) => {
          logError("Layout: failed to load group waiting request counts", e);
          return {};
        });
    [hasServingAccess, memberships, discoveryOn, creationPolicy, photoUrl, waitingRequests, groupWaitingRequests] = await Promise.all([
      loadServingAccess(),
      membershipsLoad,
      getDiscoveryOn(),
      getGroupCreationPolicy(),
      // Fail-soft: null renders the person's initials.
      mintSignedUrl(profile?.avatar_url),
      loadWaitingRequests(),
      loadGroupWaitingRequests(),
    ]);
  }

  // Free on every path: generateMetadata() above already awaited this, and
  // cache() memoizes it for the request. Anonymous requests resolve no org,
  // so this renders the platform default unless the request is
  // authenticated (lib/branding.ts).
  const b = await getRequestBranding();

  const account = user
    ? buildAccount({ profile, email: user.email ?? null, isOperator: isPlatformAdmin, photoUrl })
    : null;

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
          <SidebarProvider
            account={account}
            hasServingAccess={hasServingAccess}
            orgName={b.display_name}
            waitingRequests={waitingRequests}
            groupWaitingRequests={groupWaitingRequests}
          >
            <Header />
            <AppShell>{children}</AppShell>
          </SidebarProvider>
        </GroupProvider>
        {/* Signed in, Help, Privacy and Terms live in the account menu. */}
        {!user && <Footer />}
        <Toaster />
        <UsageRecorder />
        {process.env.THIRD_PARTY_PAGE_VIEWS === "on" && <PageMeasurement />}
      </body>
    </html>
  );
}
