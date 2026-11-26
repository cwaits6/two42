// Where a photo copied from the church's records is stored: the person's own
// folder in the avatars bucket, under the org prefix like every upload, so the
// storage policies and delete_person() cover it. Named apart from a member's
// own upload ("avatar"), so their upload is a different address and replaces
// the church's photo. lib/integrations/records/photo.ts builds the same key
// from lib/storagePaths.ts; its test holds the two together.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function recordsPhotoKey(orgId: string, profileId: string): string {
  if (!UUID.test(orgId) || !UUID.test(profileId)) throw new Error("records photo key needs an org and a profile id");
  return `${orgId}/profiles/${profileId}/records-photo.jpg`;
}

/** A child added to a household from the records: their household member folder, which delete_person() also clears. */
export function recordsChildPhotoKey(orgId: string, familyMemberId: string): string {
  if (!UUID.test(orgId) || !UUID.test(familyMemberId)) {
    throw new Error("records photo key needs an org and a household member id");
  }
  return `${orgId}/family-members/${familyMemberId}/records-photo.jpg`;
}

export interface RecordsPhotoStorage {
  storage: {
    from(bucket: "avatars"): {
      upload(
        path: string,
        body: Uint8Array,
        options: { contentType: string; upsert: boolean; cacheControl: string },
      ): PromiseLike<{ error: { message: string } | null }>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
      remove(paths: string[]): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

/** Stores the photo for this person in this church and returns the address profiles.avatar_url holds. */
export function storeRecordsPhoto(
  client: RecordsPhotoStorage,
  orgId: string,
  profileId: string,
  bytes: Uint8Array,
): Promise<string> {
  return storeAt(client, recordsPhotoKey(orgId, profileId), bytes);
}

/** Stores the photo for a child added to a household and returns the address family_members.avatar_url holds. */
export function storeRecordsChildPhoto(
  client: RecordsPhotoStorage,
  orgId: string,
  familyMemberId: string,
  bytes: Uint8Array,
): Promise<string> {
  return storeAt(client, recordsChildPhotoKey(orgId, familyMemberId), bytes);
}

/** Removes the photo stored for a child added to a household. */
export function removeRecordsChildPhoto(client: RecordsPhotoStorage, orgId: string, familyMemberId: string): Promise<void> {
  return removeAt(client, recordsChildPhotoKey(orgId, familyMemberId));
}

async function storeAt(client: RecordsPhotoStorage, key: string, bytes: Uint8Array): Promise<string> {
  // org-anchor: storage objects carry no org_id; the key's first segment is orgId, which the caller resolved by iterating orgs.
  const bucket = client.storage.from("avatars");
  const { error } = await bucket.upload(key, bytes, { contentType: "image/jpeg", upsert: true, cacheControl: "3600" });
  if (error) throw new Error(`records photo upload failed: ${error.message}`);
  return bucket.getPublicUrl(key).data.publicUrl;
}

/** Removes the photo stored for this person in this church. */
export function removeRecordsPhoto(client: RecordsPhotoStorage, orgId: string, profileId: string): Promise<void> {
  return removeAt(client, recordsPhotoKey(orgId, profileId));
}

async function removeAt(client: RecordsPhotoStorage, key: string): Promise<void> {
  // org-anchor: storage objects carry no org_id; the key's first segment is orgId, which the caller resolved by iterating orgs.
  const { error } = await client.storage.from("avatars").remove([key]);
  if (error) throw new Error(`records photo removal failed: ${error.message}`);
}
