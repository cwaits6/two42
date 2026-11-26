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

export interface RecordsPhotoStorage {
  storage: {
    from(bucket: "avatars"): {
      upload(
        path: string,
        body: Uint8Array,
        options: { contentType: string; upsert: boolean; cacheControl: string },
      ): PromiseLike<{ error: { message: string } | null }>;
      getPublicUrl(path: string): { data: { publicUrl: string } };
    };
  };
}

/** Stores the photo for this person in this church and returns the address profiles.avatar_url holds. */
export async function storeRecordsPhoto(
  client: RecordsPhotoStorage,
  orgId: string,
  profileId: string,
  bytes: Uint8Array,
): Promise<string> {
  const key = recordsPhotoKey(orgId, profileId);
  // org-anchor: storage objects carry no org_id; the key's first segment is orgId, which the caller resolved by iterating orgs.
  const bucket = client.storage.from("avatars");
  const { error } = await bucket.upload(key, bytes, { contentType: "image/jpeg", upsert: true, cacheControl: "3600" });
  if (error) throw new Error(`records photo upload failed: ${error.message}`);
  return bucket.getPublicUrl(key).data.publicUrl;
}
