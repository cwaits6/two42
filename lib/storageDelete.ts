// Server-context deletes, for a caller with no browser session. Browser
// components use deleteImage() in lib/uploadImage.ts.
//
// This module imports @/lib/supabase/server and therefore next/headers, so it
// must never be imported from a "use client" module. It owns its client and
// never accepts a SupabaseClient parameter, for the reason lib/storageRead.ts
// gives. The service client ignores the org partition on storage.objects, so the
// check against orgId here is what stands in for the isolation policy.

import { createServiceClient } from "@/lib/supabase/server";
import { keyIsInAnotherOrg } from "@/lib/storagePaths";

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
  if (refused.length > 0) {
    console.error("removeAvatarObjects: refused a key outside org %s: %s", orgId, refused.join(", "));
  }
  if (allowed.length === 0) return refused;

  let removed = new Set<string>();
  try {
    const service = await createServiceClient();
    // org-anchor: storage.objects has no org_id; the keys were checked against orgId above
    const { data, error } = await service.storage.from("avatars").remove(allowed);
    if (error) throw new Error(error.message);
    removed = new Set((data ?? []).map((object) => object.name));
  } catch (err) {
    console.error("removeAvatarObjects:", err instanceof Error ? err.message : typeof err);
  }

  const left = allowed.filter((key) => !removed.has(key));
  if (left.length > 0) {
    console.error("removeAvatarObjects: still stored in org %s: %s", orgId, left.join(", "));
  }
  return [...refused, ...left];
}
