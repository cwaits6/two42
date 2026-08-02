import { createBrowserClient } from "@supabase/ssr";
import { resolveOrgSlug } from "@/lib/org";

export function createClient(orgSlug?: string) {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      // Org resolution for anonymous requests (Phase 2, CWA-9): without
      // this header the anon join form's insert would fail closed —
      // app_request_org_id() would resolve no org. Authenticated sessions
      // ignore it (the principal's own org always wins).
      // `orgSlug` is the explicit override used by the public per-org routes
      // (app/[orgSlug]/join): the anon insert goes browser → PostgREST
      // directly, so the browser client must send the same URL slug the page
      // resolved server-side or the RLS WITH CHECK rejects every submit.
      global: {
        headers: {
          "x-two42-org": orgSlug ?? resolveOrgSlug(),
        },
      },
    }
  );
}
