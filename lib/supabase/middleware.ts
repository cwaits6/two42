import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isContentEditorAllowed } from "@/lib/admin-access";
import { isValidOrgSlug, resolveOrgSlug } from "@/lib/org";
import { siteConfig } from "@/lib/config";
import {
  createHostResolutionCache,
  lookupCustomDomainViaRpc,
  resolveHostToOrg,
} from "@/lib/supabase/host-resolution";

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

// Module scope: persists for the life of this serverless/edge instance.
// Best-effort hot-path cache only — see lib/supabase/host-resolution.ts.
const lookupCustomDomainCached = createHostResolutionCache();

export async function updateSession(request: NextRequest) {
  // --- Host → org resolution (Phase 5 PR 3, CWA-67 / #360) ---
  // Must run before any request/response header is built below: the
  // Supabase client's x-two42-org header (further down) depends on it.
  const rawHost =
    request.headers.get("host") ?? request.headers.get("x-forwarded-host") ?? "";
  const { orgSlug: resolvedOrgSlug, hostResolvedOrg } = await resolveHostToOrg(
    rawHost,
    {
      apex: siteConfig.platformApex,
      siteUrl: siteConfig.url,
      envSlug: resolveOrgSlug(),
      lookupCustomDomain: (host) =>
        lookupCustomDomainCached(host, lookupCustomDomainViaRpc),
    }
  );

  if (!resolvedOrgSlug) {
    // Fail closed (§5.2 step 4): an unresolvable, untrusted host names no
    // org and gets no app response at all — never the deployment's own
    // env-pinned tenant. This must be reachable before any route runs.
    return new NextResponse("Not Found", { status: 404 });
  }

  // Generate a nonce for CSP
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  // Create request headers with nonce for downstream RSC access
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  // Strip any inbound copy unconditionally — a client can send arbitrary
  // headers, and this one must never reach a Server Component as
  // attacker input. Set only when the HOST ITSELF named an org (never on
  // the trusted-host env-pin fallback), so downstream code can tell "host
  // X" apart from "the env pin applied" — lib/supabase/server.ts's
  // assertPathOrgMatchesHost depends on that distinction.
  requestHeaders.delete("x-two42-resolved-org");
  if (hostResolvedOrg && isValidOrgSlug(resolvedOrgSlug)) {
    requestHeaders.set("x-two42-resolved-org", resolvedOrgSlug);
  }

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
      // Org resolution header (Phase 2 CWA-9, host-aware since Phase 5 PR 3
      // CWA-67) — see lib/org.ts and lib/supabase/host-resolution.ts. The
      // middleware client only serves authenticated auth/role checks, where
      // the principal's org wins, but every client sends the header so anon
      // paths never depend on which client they happen to use.
      global: {
        headers: {
          "x-two42-org": resolvedOrgSlug,
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

  // Protected routes - require authentication
  const protectedPaths = ["/dashboard", "/announcements", "/update-password", "/events", "/lectures"];
  const adminPaths = ["/admin"];

  const isProtected = protectedPaths.some((p) => pathname.startsWith(p));
  const isAdmin = adminPaths.some((p) => pathname.startsWith(p));
  const isPlatform = pathname.startsWith("/platform");

  if ((isProtected || isAdmin || isPlatform) && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("redirect", pathname);
    return redirectTo(url);
  }

  if (isAdmin && user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const contentEditorAllowed =
      profile?.role === "content_editor" && isContentEditorAllowed(pathname);

    if (profile?.role !== "admin" && !contentEditorAllowed) {
      const url = request.nextUrl.clone();
      url.pathname = "/dashboard";
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

  // Set CSP header on the response
  supabaseResponse.headers.set("Content-Security-Policy", cspHeader);

  return supabaseResponse;
}
