// The directory's details shown live from the church's records. The viewer's
// own request client reads who they may see, through the same RLS-scoped
// directory views the directory renders; only then is the provider asked, once,
// for exactly those people. The org comes from app_request_org_id() on that
// same client, the anchor every service-role read in store.ts filters on.
//
// Nothing read from the records is stored, cached, logged or put in an error.
// Imports next/headers through @/lib/supabase/server; never import it from a
// "use client" module.
import { createClient } from "@/lib/supabase/server";
import { logError, logWarn } from "@/lib/log";
import { resolveRequestOrgId } from "@/lib/org";
import { RecordsError } from "./errors";
import { loadRecordsSecret } from "./crypto";
import { liveDirectory, type LiveDirectory, planLiveRequest, type VisibleHousehold, type VisiblePerson } from "./livePlan";
import { loadCredentials, readLiveSources, readMode } from "./store";
import type { RecordsLiveDetails } from "./types";

const ROUTE = "/api/directory/live";
const OFF: LiveDirectory = { mode: "off" };

/** The church's live connection, or null when it doesn't show details live: never connected, copy mode, or a provider without it. */
async function liveConnection(orgId: string) {
  const secret = loadRecordsSecret();
  if (!secret) return null;
  const church = await readMode(orgId);
  if (church.mode !== "live") return null;
  const loaded = await loadCredentials(orgId, secret);
  const source = loaded?.provider.live;
  return loaded && source ? { ...church, source, creds: loaded.creds } : null;
}

/** Whether the directory should ask for live details; read by the directory layouts without calling the provider. */
export async function liveDirectoryOn(): Promise<boolean> {
  if (!loadRecordsSecret()) return false;
  const supabase = await createClient();
  const orgId = await resolveRequestOrgId(supabase, { label: "directory live" });
  if (!orgId) return false;
  try {
    return (await liveConnection(orgId)) !== null;
  } catch (err) {
    logError("Church records live mode read failed", err, { route: "/directory", ids: { org: orgId } });
    return false;
  }
}

/**
 * The live details of everyone `viewerId` may see in the directory, from one
 * batch to the provider. "off" for a church that doesn't show details live,
 * without touching the provider. When the records can't be reached every
 * detail that would have come from them is unavailable, and the rest of the
 * directory is unaffected.
 */
export async function readLiveDirectory(viewerId: string, today = new Date()): Promise<LiveDirectory> {
  if (!loadRecordsSecret()) return OFF;
  const supabase = await createClient();
  const orgId = await resolveRequestOrgId(supabase, { label: "directory live" });
  if (!orgId) return OFF;

  let connection: Awaited<ReturnType<typeof liveConnection>>;
  try {
    connection = await liveConnection(orgId);
  } catch (err) {
    logError("Church records live mode read failed", err, { route: ROUTE, ids: { org: orgId } });
    return OFF;
  }
  if (!connection) return OFF;

  const [people, households, viewer] = await Promise.all([
    supabase.from("profiles_directory").select("id, family_id, relationship, birth_month, birth_day"),
    supabase
      .from("families_directory_full")
      .select("id, address_line1, city, anniversary_month, anniversary_day, family_members_list"),
    supabase.from("profiles").select("id, family_id, relationship").eq("id", viewerId).maybeSingle(),
  ]);
  const readError = people.error ?? households.error ?? viewer.error;
  if (readError || !viewer.data) {
    logError("Church records live directory read failed", readError ?? undefined, { route: ROUTE, ids: { org: orgId } });
    return OFF;
  }
  const visiblePeople = (people.data ?? []) as VisiblePerson[];
  const visibleHouseholds = ((households.data ?? []) as unknown as VisibleHousehold[]).map((h) => ({
    ...h,
    family_members_list: Array.isArray(h.family_members_list) ? h.family_members_list : [],
  }));

  let sources;
  try {
    sources = await readLiveSources(
      orgId,
      {
        profiles: visiblePeople.map((p) => p.id),
        households: visibleHouseholds.map((h) => h.id),
        members: visibleHouseholds.flatMap((h) => h.family_members_list.map((m) => m.id)),
      },
      connection.suggestChildren,
    );
  } catch (err) {
    logError("Church records live sources read failed", err, { route: ROUTE, ids: { org: orgId } });
    return OFF;
  }

  const plan = planLiveRequest({ viewer: viewer.data, people: visiblePeople, households: visibleHouseholds, sources });
  let details: RecordsLiveDetails | null = null;
  if (plan.planned.length > 0) {
    try {
      details = await connection.source.details(connection.creds, { people: plan.people, families: plan.families });
    } catch (err) {
      // The error's kind only: a provider's answer is never logged.
      logWarn("Church records live details unavailable", undefined, {
        route: ROUTE,
        step: err instanceof RecordsError ? err.kind : "provider",
        ids: { org: orgId },
      });
    }
  }
  return liveDirectory(plan, details, today);
}
