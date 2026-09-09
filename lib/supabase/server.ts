import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { resolveOrgSlug } from "@/lib/org";

export async function createClient(orgSlug?: string) {
  const cookieStore = await cookies();
  const resolved = (await headers()).get("x-two42-resolved-org");

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      // Org resolution for anonymous reads, host-aware: the DB's
      // app_request_org_id() reads this
      // header only when there is no authenticated principal, and only to
      // select among public content. Precedence: an explicit `orgSlug` wins
      // (the public per-org routes, app/[orgSlug]/join, address the org by
      // URL), then the middleware-resolved host slug (x-two42-resolved-org,
      // set only when the host itself named an org — see
      // lib/supabase/middleware.ts), then the env pin.
      global: {
        headers: {
          "x-two42-org": orgSlug ?? resolved ?? resolveOrgSlug(),
        },
      },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  );
}

/**
 * Host-first precedence: if the host itself
 * resolved an org (x-two42-resolved-org is set — see
 * lib/supabase/middleware.ts) and a route's own path slug names a
 * *different* org, 404 rather than silently serving the path slug's org
 * under the wrong host. Unset on the platform host and every
 * trusted-host fallback, where the path slug behaves exactly as before
 * this PR. Call before constructing a Supabase client for the path slug.
 */
export async function assertPathOrgMatchesHost(orgSlug: string): Promise<void> {
  const resolved = (await headers()).get("x-two42-resolved-org");
  if (resolved && resolved !== orgSlug) {
    notFound();
  }
}

export async function createServiceClient() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );
}
