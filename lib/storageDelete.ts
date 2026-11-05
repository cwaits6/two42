// Server-context deletes, for a caller with no browser session. Browser
// components use deleteImage() in lib/uploadImage.ts.
//
// This module imports @/lib/supabase/server and therefore next/headers, so it
// must never be imported from a "use client" module. It owns its client and
// never accepts a SupabaseClient parameter, for the reason lib/storageRead.ts
// gives. The service client ignores the org partition on storage.objects, so the
// check against orgId here is what stands in for the isolation policy.

import { createServiceClient } from "@/lib/supabase/server";
import { keyIsInAnotherOrg, STORAGE_KINDS } from "@/lib/storagePaths";
import { logError, type LogContext, stepOf } from "@/lib/log";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A key as the ids in it, never the path: the kind and the row the object
 * belongs to are enough to find its folder without listing the org's.
 */
function keyContext(orgId: string, key: string): LogContext {
  const segments = key.split("/");
  const kind = segments.find((segment) => STORAGE_KINDS.some((known) => known === segment));
  const ids = segments.filter((segment) => UUID.test(segment));
  return {
    step: kind && stepOf(kind),
    ids: { org: orgId, keyOrg: ids.length > 1 ? ids[0] : undefined, entity: ids.at(-1) },
  };
}

/**
 * Removes objects from the avatars bucket. `orgId` must come from a validated
 * anchor. A key from before org partitioning names no org, so it's accepted as
 * given: pass only keys found from a row already scoped to that org.
 *
 * @returns the keys still stored. Never throws, because the caller has already
 *   committed the deletion these belong to and has to report this as it is.
 */
export async function removeAvatarObjects(orgId: string, keys: string[]): Promise<string[]> {
  const allowed = keys.filter((key) => !keyIsInAnotherOrg(key, orgId));
  const refused = keys.filter((key) => keyIsInAnotherOrg(key, orgId));
  for (const key of refused) {
    logError("removeAvatarObjects: refused a key outside org", undefined, keyContext(orgId, key));
  }
  if (allowed.length === 0) return refused;

  let removed = new Set<string>();
  try {
    const service = await createServiceClient();
    // org-anchor: storage.objects has no org_id; the keys were checked against orgId above
    const { data, error } = await service.storage.from("avatars").remove(allowed);
    if (error) logError("removeAvatarObjects: remove failed", error, { ids: { org: orgId, keys: allowed.length } });
    if (error) throw new Error(error.message);
    removed = new Set((data ?? []).map((object) => object.name));
  } catch (err) {
    logError("removeAvatarObjects", err);
  }

  const left = allowed.filter((key) => !removed.has(key));
  for (const key of left) {
    logError("removeAvatarObjects: still stored in org", undefined, keyContext(orgId, key));
  }
  return [...refused, ...left];
}
