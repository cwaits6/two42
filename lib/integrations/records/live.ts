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
import { fetchAll } from "@/lib/supabase/fetchAll";
import { logError, logWarn, stepOf } from "@/lib/log";
import { RecordsError } from "./errors";
import { loadRecordsSecret } from "./crypto";
import { LIVE_UNAVAILABLE, liveDirectory, type LiveDirectory, planLiveRequest, type VisibleHousehold, type VisiblePerson } from "./livePlan";
import { liveSourceOf, providerFor } from "./providers";
import { loadCredentials, readConnection, readLiveSources, readMode } from "./store";
import type { RecordsLiveDetails } from "./types";

const OFF: LiveDirectory = { mode: "off" };

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * The request's org, as resolveRequestOrgId() resolves it, but telling an
 * errored lookup (`failed`) from a request with no org: one asks and is
 * answered unavailable, the other is off. `orgId` is null in both.
 */
async function requestOrg(supabase: Supabase): Promise<{ orgId: string | null; failed: boolean }> {
  // org-anchor: app_request_org_id() IS the org resolver; everything after this is scoped on the value it returns
  const { data, error } = await supabase.rpc("app_request_org_id");
  if (error) {
    logError("Org resolution failed", error, { step: stepOf("directory live") });
    return { orgId: null, failed: true };
  }
  const orgId = typeof data === "string" ? data : null;
  if (!orgId) logError("Org resolution returned NULL", undefined, { step: stepOf("directory live") });
  return { orgId, failed: false };
}

/** The church's live connection, or null when it doesn't show details live: never connected, copy mode, or a provider without it. */
async function liveConnection(orgId: string) {
  const connection = await readConnection(orgId);
  const source = liveSourceOf(providerFor(connection?.provider));
  if (!connection || !source) return null;
  const church = await readMode(orgId);
  return church.mode === "live" ? { ...church, source, connectionId: connection.connectionId } : null;
}

/**
 * The key, or null when it can't be opened, such as after RECORDS_KEY_SECRET
 * changed, or when the connection was replaced since `connectionId` was read:
 * the links were read for that connection, and another one's ids could name
 * other people. The records then can't be reached.
 */
async function openCredentials(orgId: string, secret: Buffer, connectionId: string) {
  try {
    const loaded = await loadCredentials(orgId, secret);
    return loaded?.connectionId === connectionId ? loaded.creds : null;
  } catch (err) {
    logError("Church records key couldn't be opened for live details", err, { route: "/api/directory/live", ids: { org: orgId } });
    return null;
  }
}

/** The error's kind only: a provider's answer is never logged. */
function warnUnavailable(err: unknown, orgId: string) {
  logWarn("Church records live details unavailable", undefined, {
    route: "/api/directory/live",
    step: err instanceof RecordsError ? err.kind : "provider",
    ids: { org: orgId },
  });
}

/** Whether the directory should ask for live details; read by the directory layouts without calling the provider. */
export async function liveDirectoryOn(): Promise<boolean> {
  if (!loadRecordsSecret()) return false;
  const supabase = await createClient();
  const { orgId, failed } = await requestOrg(supabase);
  // A lookup that errored can't tell a live church from any other, so it asks and is answered unavailable.
  if (!orgId) return failed;
  try {
    return (await liveConnection(orgId)) !== null;
  } catch (err) {
    logError("Church records live connection or mode read failed", err, { route: "/directory", ids: { org: orgId } });
    // A church whose connection reads as none, or not live-capable, answered off above; one whose connection or mode can't be read is asked, and its request answers unavailable.
    return true;
  }
}

/**
 * The live details of everyone `viewerId` may see in the directory, from one
 * batch to the provider. "off" for a church that doesn't show details live,
 * without touching the provider. When the records can't be reached every
 * detail that would have come from them is unavailable, and when two42's own
 * reads fail (the org, the connection, the mode, the directory, the sources), the
 * whole answer is; the rest of the directory is unaffected either way.
 */
export async function readLiveDirectory(viewerId: string, today = new Date()): Promise<LiveDirectory> {
  const secret = loadRecordsSecret();
  if (!secret) return OFF;
  const supabase = await createClient();
  const { orgId, failed } = await requestOrg(supabase);
  if (!orgId) return failed ? LIVE_UNAVAILABLE : OFF;

  let connection: Awaited<ReturnType<typeof liveConnection>>;
  try {
    connection = await liveConnection(orgId);
  } catch (err) {
    logError("Church records live connection or mode read failed", err, { route: "/api/directory/live", ids: { org: orgId } });
    return LIVE_UNAVAILABLE;
  }
  if (!connection) return OFF;

  const [people, households, viewer] = await Promise.all([
    fetchAll((from, to) =>
      supabase
        .from("profiles_directory")
        .select("id, family_id, relationship, birth_month, birth_day")
        .order("id")
        .range(from, to),
    ),
    fetchAll((from, to) =>
      supabase
        .from("families_directory_full")
        .select(
          "id, address_line1, address_line2, city, state, postal_code, anniversary_month, anniversary_day, family_members_list",
        )
        .order("id")
        .range(from, to),
    ),
    supabase.from("profiles").select("id, family_id, relationship").eq("id", viewerId).maybeSingle(),
  ]);
  const readError = people.error ?? households.error ?? viewer.error;
  if (readError || !viewer.data) {
    logError("Church records live directory read failed", readError ?? undefined, { route: "/api/directory/live", ids: { org: orgId } });
    return LIVE_UNAVAILABLE;
  }
  const visiblePeople: VisiblePerson[] = people.data ?? [];
  const visibleHouseholds = (households.data ?? []).map(
    (h) =>
      ({
        ...h,
        family_members_list: Array.isArray(h.family_members_list)
          ? (h.family_members_list as unknown as VisibleHousehold["family_members_list"])
          : [],
      }) satisfies VisibleHousehold,
  );

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
    logError("Church records live sources read failed", err, { route: "/api/directory/live", ids: { org: orgId } });
    return LIVE_UNAVAILABLE;
  }

  const plan = planLiveRequest({ viewer: viewer.data, people: visiblePeople, households: visibleHouseholds, sources });
  let details: RecordsLiveDetails | null = null;
  const creds = plan.planned.length > 0 ? await openCredentials(orgId, secret, connection.connectionId) : null;
  if (creds) {
    try {
      details = await connection.source.details(creds, { people: plan.people, families: plan.families });
      if (details.error !== undefined) warnUnavailable(details.error, orgId);
    } catch (err) {
      warnUnavailable(err, orgId);
    }
  }
  return liveDirectory(plan, details, today);
}
