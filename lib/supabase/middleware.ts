import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isContentEditorAllowed } from "@/lib/admin-access";
import {
  GROUP_COOKIE,
  LEGACY_GROUP_PREFIXES,
  groupIdFromPath,
  isLegacyGroupPath,
  legacyRedirectTarget,
  resolveActiveGroup,
} from "@/lib/groups/active";
import { loadGroupMemberships } from "@/lib/groups/memberships";
import { isExpectedHost, normalizeHost, resolveOrgSlug } from "@/lib/org";
import { siteConfig } from "@/lib/config";

const isDev = process.env.NODE_ENV === "development";

// Narrow the CSP img-src allowlist to the specific Supabase project
// origin rather than a wildcard. Falls back empty if not configured.
const supabaseOrigin = (() => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return "";
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
})();

export async function updateSession(request: NextRequest) {
  const rawHost =
    request.headers.get("host") ?? request.headers.get("x-forwarded-host") ?? "";
  if (!isExpectedHost(normalizeHost(rawHost), { siteUrl: siteConfig.url })) {
    // Fail closed: a host this deployment does not serve gets no app
    // response at all. This must be reachable before any route runs.
    return new NextResponse("Not Found", { status: 404 });
  }

  // Generate a nonce for CSP
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  // Create request headers with nonce for downstream RSC access
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  // Build CSP dynamically with nonce instead of unsafe-inline
  const cspHeader = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""} https://va.vercel-scripts.com https://maps.googleapis.com https://maps.gstatic.com blob:`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    `img-src 'self' data: blob: https://maps.gstatic.com https://maps.googleapis.com${supabaseOrigin ? ` ${supabaseOrigin}` : ""}${isDev ? " http://127.0.0.1:* http://localhost:*" : ""}`,
    "font-src 'self' https://fonts.gstatic.com",
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://vitals.vercel-insights.com https://maps.googleapis.com https://places.googleapis.com https://maps.gstatic.com blob:${isDev ? " http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*" : ""}`,
    "frame-src 'self' https://www.google.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "worker-src blob:",
    "manifest-src 'self'",
  ].join("; ");

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      // Org resolution header — see lib/org.ts. The middleware client only
      // serves authenticated auth/role checks, where the principal's org
      // wins, but every client sends the header so anon paths never depend
      // on which client they happen to use.
      global: {
        headers: {
          "x-two42-org": resolveOrgSlug(),
        },
      },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // getUser() may refresh the session, in which case setAll() has written the
  // rotated auth cookies onto supabaseResponse. A bare NextResponse.redirect()
  // starts from an empty cookie jar and drops them, so the browser keeps
  // replaying the stale refresh token. Every early return below goes through
  // this helper.
  const redirectTo = (url: URL) => {
    const response = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie);
    });
    return response;
  };

  const pathname = request.nextUrl.pathname;

  // Protected routes - require authentication. Boundary-matched, because
  // "/g" would otherwise swallow "/grace/join" (the anonymous per-org join
  // page) and any other slug starting with the same letters.
  const protectedPaths = [
    "/g",
    "/dashboard",
    "/calendar",
    "/find-a-group",
    "/update-password",
    ...LEGACY_GROUP_PREFIXES,
  ];
  const adminPaths = ["/admin"];
  const atOrUnder = (p: string) => pathname === p || pathname.startsWith(p + "/");

  // /serving/go is the emailed token landing and must stay anonymous.
  const isProtected = !atOrUnder("/serving/go") && protectedPaths.some(atOrUnder);
  const isAdmin = adminPaths.some(atOrUnder);
  const isPlatform = pathname.startsWith("/platform");
  const isLegacy = isLegacyGroupPath(pathname);

  if ((isProtected || isAdmin || isPlatform) && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return redirectTo(url);
  }

  let profile: { role: string; org_id: string } | null = null;
  if ((isAdmin || isLegacy) && user) {
    const { data } = await supabase
      .from("profiles")
      .select("role, org_id")
      .eq("id", user.id)
      .single();
    profile = data;
  }

  if (isAdmin && user) {
    const contentEditorAllowed =
      profile?.role === "content_editor" && isContentEditorAllowed(pathname);

    if (profile?.role !== "admin" && !contentEditorAllowed) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return redirectTo(url);
    }
  }

  // Legacy unprefixed content routes (old bookmarks, links still in emails)
  // move under the member's active group. The clone keeps the query string.
  if (isLegacy && user) {
    const target = legacyRedirectTarget(pathname);
    if (target) {
      const url = request.nextUrl.clone();
      if (!target.needsGroup) {
        url.pathname = target.path;
        return redirectTo(url);
      }
      const memberships =
        profile && profile.role !== "pending"
          ? await loadGroupMemberships(supabase, { profileId: user.id, orgId: profile.org_id })
          : [];
      const group = resolveActiveGroup({
        cookieGroupId: request.cookies.get(GROUP_COOKIE)?.value,
        memberships,
      });
      url.pathname = group ? target.pathFor(group.id) : "/dashboard";
      if (!group) url.search = "";
      return redirectTo(url);
    }
  }

  // /platform is gated on platform_admins, never profiles.role — an org
  // admin is not a platform operator. Defense in depth only: the layout,
  // pages, and route handlers each repeat this check independently. An RPC
  // error denies (fail closed).
  if (isPlatform && user) {
    const { data: isPlatformAdmin, error } = await supabase.rpc("is_platform_admin");
    if (error || isPlatformAdmin !== true) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
      return redirectTo(url);
    }
  }

  // Remember the group the member is in. The value is a preference that the
  // resolver intersects with verified memberships at read time, so an id the
  // member is not in (or a 404'd one) is simply ignored. Written here and
  // nowhere else: server components cannot set cookies.
  const urlGroupId = groupIdFromPath(pathname);
  if (urlGroupId) {
    supabaseResponse.cookies.set(GROUP_COOKIE, urlGroupId, {
      httpOnly: true,
      sameSite: "lax",
      secure: !isDev,
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  // Set CSP header on the response
  supabaseResponse.headers.set("Content-Security-Policy", cspHeader);

  return supabaseResponse;
}
