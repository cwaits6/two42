// Supabase Edge Function: attach-org-domains
//
// The custom-domain attachment worker. It is the only component in the
// system that holds the Vercel API token (a function secret, never a Next.js
// env var) and the SOLE writer of org_domains.attached_at. Two jobs per
// active org, in order:
//   1. attach — rows verified + unattached: take the single-flight lease,
//      POST the domain to the Vercel project, confirm, stamp attached_at;
//   2. detach — rows in 'removing': take the same lease, DELETE the domain
//      from the project (404 = already gone), then hard-delete the tombstone.
// The orchestration lives in _shared/domain-attach.ts and is unit-tested
// against fakes; this file only wires real clients and the HTTP contract.
//
// Driven by pg_cron every 10 minutes (the lease window) via
// supabase/migrations/20260911000000_attach_org_domains_schedule_and_events.sql,
// the same helper the reminder functions use. See docs/security/domains.md
// for the secrets it needs and the manual invocation for debugging.
//
// Runs with the service key (BYPASSRLS), so tenant isolation lives in the
// query text: iterates every active organization, every org_domains query
// in _shared/domain-lease.ts carries an explicit org_id predicate, and
// every org_domain_worker_events read and insert in _shared/domain-events.ts
// carries an explicit org_id.

// Pinned exactly, matching the two reminder functions — deno.lock's
// integrity entry covers this URL; bump all three together.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.9";
import { resolveServiceKey } from "../_shared/service-key.ts";
import {
  forEachOrg,
  listActiveOrgs,
  summarize,
  type OrgListClient,
  type OrgRunCounts,
} from "../_shared/orgs.ts";
import {
  ATTACH_LEASE_WINDOW_MS,
  createDomainLeaseClient,
  type DomainTableClient,
} from "../_shared/domain-lease.ts";
import { createDomainEventsClient, type DomainEventsTableClient } from "../_shared/domain-events.ts";
import { resolvePlatformApex } from "../_shared/domain-denylist.ts";
import { createVercelClient } from "../_shared/vercel.ts";
import { attachDomainsForOrg, detachDomainsForOrg } from "../_shared/domain-attach.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SECRET_KEY = resolveServiceKey();

// Function secrets (`supabase secrets set`), documented in
// docs/security/domains.md. Read as optional so a missing token is a clear
// 500 below, not a "Bearer undefined" that Vercel would answer with 403 —
// which the worker would faithfully report as a permanent failure per row.
const VERCEL_API_TOKEN = Deno.env.get("VERCEL_API_TOKEN") ?? "";
const VERCEL_PROJECT_ID = Deno.env.get("VERCEL_PROJECT_ID") ?? "";
const VERCEL_TEAM_ID = Deno.env.get("VERCEL_TEAM_ID") || undefined;
// Mirrors NEXT_PUBLIC_PLATFORM_APEX (Deno cannot read Next's env); the
// worker's denylist refuses this apex and every subdomain of it. A blank
// value throws here, at startup, instead of quietly disabling the denylist.
const PLATFORM_APEX = resolvePlatformApex(Deno.env.get("PLATFORM_APEX"));

// Same concrete factory shape as the reminder functions (see the note in
// send-event-reminders/index.ts on why ReturnType of this binds the generics).
function createServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async () => {
  if (!VERCEL_API_TOKEN || !VERCEL_PROJECT_ID) {
    console.error("attach-org-domains: VERCEL_API_TOKEN and VERCEL_PROJECT_ID must be set; nothing attempted");
    return json({ error: "Vercel credentials are not configured" }, 500);
  }

  try {
    const supabase = createServiceClient();
    // Cast: structurally checking the full SupabaseClient against the narrow
    // interfaces trips TS2589 (excessively deep instantiation) on current
    // supabase-js — the same cast the reminder functions carry.
    const orgs = await listActiveOrgs(supabase as unknown as OrgListClient);
    const lease = createDomainLeaseClient(supabase as unknown as DomainTableClient);
    const events = createDomainEventsClient(supabase as unknown as DomainEventsTableClient);
    const vercel = createVercelClient({
      token: VERCEL_API_TOKEN,
      projectId: VERCEL_PROJECT_ID,
      teamId: VERCEL_TEAM_ID,
    });

    const summary = summarize(
      await forEachOrg(orgs, async (org): Promise<OrgRunCounts> => {
        const attach = await attachDomainsForOrg(lease, vercel, events, org, PLATFORM_APEX, ATTACH_LEASE_WINDOW_MS);
        const detach = await detachDomainsForOrg(lease, vercel, events, org, ATTACH_LEASE_WINDOW_MS);
        const itemFailures = [...(attach.itemFailures ?? []), ...(detach.itemFailures ?? [])];
        return {
          sent: attach.sent + detach.sent,
          sendFailures: attach.sendFailures + detach.sendFailures,
          ...(itemFailures.length ? { itemFailures } : {}),
        };
      }),
    );

    if (summary.failed.length > 0 || summary.failedItems.length > 0) {
      console.error(
        "run completed with failures: %d/%d orgs failed, %d domains failed",
        summary.failed.length,
        summary.orgs,
        summary.failedItems.length,
      );
    }
    // Status contract: see summarize() in _shared/orgs.ts — 500 when any org
    // or domain failed, 200 only for a clean run. The summary's count keys
    // are named for the reminder functions; here `emailsSent` is domains
    // attached + detached and `emailsFailed` is domains left in a failed
    // state, which `domainsChanged`/`domainsFailed` restate by name.
    return json(
      {
        message: `Attached or detached ${summary.emailsSent} domains`,
        domainsChanged: summary.emailsSent,
        domainsFailed: summary.emailsFailed,
        ...summary,
      },
      summary.failed.length > 0 || summary.failedItems.length > 0 ? 500 : 200,
    );
  } catch (err) {
    // Total failure (e.g. listActiveOrgs threw) — no org ran.
    console.error("attach-org-domains run aborted before completion:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
