// A photo copied from the church's records, stored in two42 like any upload so
// no page ever links to the church's server. Server-only: imports next/headers
// through @/lib/supabase/server.
import { createServiceClient } from "@/lib/supabase/server";
import { orgObjectPath, relObjectPath } from "@/lib/storagePaths";

/** The person's own folder under the church's prefix, the same key the nightly refresh builds. */
export function recordsPhotoPath(orgId: string, profileId: string): string {
  return `${orgObjectPath(orgId, relObjectPath("profiles", profileId, "records-photo"))}.jpg`;
}

/**
 * Stores the photo and returns the address profiles.avatar_url holds. `orgId`
 * must come from requireOrgAdmin(): the service client ignores the storage
 * policies, so the org prefix built from it is the tenant boundary here.
 */
export async function storeRecordsPhoto(orgId: string, profileId: string, bytes: Uint8Array): Promise<string> {
  const service = await createServiceClient();
  const path = recordsPhotoPath(orgId, profileId);
  // org-anchor: storage.objects has no org_id; the key's first segment is orgId from requireOrgAdmin().
  const avatars = service.storage.from("avatars");
  const { error } = await avatars.upload(path, bytes, { contentType: "image/jpeg", upsert: true, cacheControl: "3600" });
  if (error) throw new Error("records photo upload failed", { cause: error });
  return avatars.getPublicUrl(path).data.publicUrl;
}
