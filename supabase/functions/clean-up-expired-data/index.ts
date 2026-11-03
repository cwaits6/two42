// Supabase Edge Function: clean-up-expired-data
//
// Nightly, on the "clean-up-expired-data-nightly" pg_cron entry defined in
// supabase/migrations/20261114000000_expired_data_cleanup.sql. The rules live in
// _shared/retention.ts and _shared/cleanup.ts. Never deletes an organizations row.

// Pinned exactly, in lockstep with the reminder functions and package-lock.json:
// `supabase functions deploy` re-resolves this URL through its own bundler, so
// the version must live in the specifier.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.9";
import { isServiceKeyCaller } from "../_shared/caller-auth.ts";
import { type CleanupClient, cleanUpOrgs, summarizeCleanup } from "../_shared/cleanup.ts";
import { listActiveOrgs, type OrgListClient } from "../_shared/orgs.ts";
import { resolveServiceKey } from "../_shared/service-key.ts";

Deno.serve(async (req) => {
  if (!isServiceKeyCaller(req)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, resolveServiceKey());
    // Casts: structurally checking the full SupabaseClient against these narrow
    // types trips TS2589 at the pinned version, as in the reminder functions.
    const orgs = await listActiveOrgs(supabase as unknown as OrgListClient);
    const results = await cleanUpOrgs(
      supabase as unknown as CleanupClient,
      orgs.map((org) => org.id),
      new Date(),
    );
    const summary = summarizeCleanup(results);
    return new Response(JSON.stringify(summary), {
      status: summary.failed.length ? 500 : 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("clean-up-expired-data failed:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
