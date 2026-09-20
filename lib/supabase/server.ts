import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { resolveOrgSlug } from "@/lib/org";

export async function createClient(orgSlug?: string) {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      // Org resolution for anonymous reads: the DB's app_request_org_id()
      // reads this header only when there is no authenticated principal,
      // and only to select among public content. An explicit `orgSlug` wins
      // (the public per-org routes, app/[orgSlug]/join, address the org by
      // URL), then the env pin. The request host never contributes.
      global: {
        headers: {
          "x-two42-org": orgSlug ?? resolveOrgSlug(),
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

export async function createServiceClient() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!
  );
}
