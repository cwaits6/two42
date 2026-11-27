// A photo copied from the church's records, stored in two42 like any upload so
// no page ever links to the church's server. Server-only: imports next/headers
// through @/lib/supabase/server.
import { createServiceClient } from "@/lib/supabase/server";
import { orgObjectPath, relObjectPath } from "@/lib/storagePaths";
import { removeAvatarObjects } from "@/lib/storageDelete";

/** The person's own folder under the church's prefix, the same key the nightly refresh builds. */
export function recordsPhotoPath(orgId: string, profileId: string): string {
  return `${orgObjectPath(orgId, relObjectPath("profiles", profileId, "records-photo"))}.jpg`;
}

/** A child's household member folder, the same key the nightly refresh builds. */
export function recordsChildPhotoPath(orgId: string, familyMemberId: string): string {
  return `${orgObjectPath(orgId, relObjectPath("family-members", familyMemberId, "records-photo"))}.jpg`;
}

/**
 * Stores the photo and returns the address profiles.avatar_url holds. `orgId`
 * must come from requireOrgAdmin(): the service client ignores the storage
 * policies, so the org prefix built from it is the tenant boundary here.
 */
export function storeRecordsPhoto(orgId: string, profileId: string, bytes: Uint8Array): Promise<string> {
  return storeAt(recordsPhotoPath(orgId, profileId), bytes);
}

/** Stores a child's photo for family_members.avatar_url; `orgId` as for storeRecordsPhoto(). */
export function storeRecordsChildPhoto(orgId: string, familyMemberId: string, bytes: Uint8Array): Promise<string> {
  return storeAt(recordsChildPhotoPath(orgId, familyMemberId), bytes);
}

async function storeAt(path: string, bytes: Uint8Array): Promise<string> {
  const service = await createServiceClient();
  // org-anchor: storage.objects has no org_id; the key's first segment is orgId from requireOrgAdmin().
  const avatars = service.storage.from("avatars");
  const { error } = await avatars.upload(path, bytes, { contentType: "image/jpeg", upsert: true, cacheControl: "3600" });
  if (error) throw new Error("records photo upload failed", { cause: error });
  return avatars.getPublicUrl(path).data.publicUrl;
}

/** Removes the stored photo; removeAvatarObjects() refuses a key outside `orgId`. Throws when it is still stored. */
export function removeRecordsPhoto(orgId: string, profileId: string): Promise<void> {
  return removeAt(orgId, recordsPhotoPath(orgId, profileId));
}

export function removeRecordsChildPhoto(orgId: string, familyMemberId: string): Promise<void> {
  return removeAt(orgId, recordsChildPhotoPath(orgId, familyMemberId));
}

// removeAvatarObjects() logs and returns what it couldn't remove rather than
// throwing; the refresh keeps its photo token only when removal throws.
async function removeAt(orgId: string, key: string): Promise<void> {
  const left = await removeAvatarObjects(orgId, [key]);
  if (left.length > 0) throw new Error("records photo removal failed");
}
