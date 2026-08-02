import imageCompression from "browser-image-compression";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { resolveOrgSlug, resolveRequestOrgId } from "@/lib/org";
import { orgObjectPath } from "@/lib/storagePaths";

export type ImageUploadType = "avatar" | "event" | "family";

interface UploadConfig {
  bucket: "avatars" | "event-images";
  maxWidthOrHeight: number;
  maxSizeMB: number;
}

// maxSizeMB is a safety ceiling aligned with the bucket's file_size_limit
// (see supabase/migrations/20260410000000_storage_buckets.sql). The real
// size control comes from maxWidthOrHeight + initialQuality — natural
// output is well under these ceilings.
const CONFIG: Record<ImageUploadType, UploadConfig> = {
  avatar: {
    bucket: "avatars",
    maxWidthOrHeight: 400,
    maxSizeMB: 0.5,
  },
  event: {
    bucket: "event-images",
    maxWidthOrHeight: 1200,
    maxSizeMB: 1,
  },
  // Family portraits live in the avatars bucket under
  // <orgId>/families/<familyId>/ (see
  // 20260803000000_storage_org_partitioned_policies.sql for the admin
  // storage policies)
  family: {
    bucket: "avatars",
    maxWidthOrHeight: 1000,
    maxSizeMB: 0.5,
  },
};

// Every object key is org-partitioned (CWA-57): the caller passes a key
// relative to the org prefix and this resolves `<orgId>/` in front of it.
// Resolved per call, never cached in module scope — a stale org id would
// survive a logout/login into a different org. resolveRequestOrgId()
// already logs both failure modes (RPC error and NULL), so the throw here
// only has to fail closed.
async function resolveOrgPrefixedPath(
  supabase: SupabaseClient,
  label: string,
  path: string,
): Promise<string> {
  const orgId = await resolveRequestOrgId(supabase, {
    label,
    orgSlug: resolveOrgSlug(),
  });
  if (!orgId) {
    throw new Error(`${label} failed: could not resolve organization`);
  }
  return `${orgObjectPath(orgId, path)}.jpg`;
}

/**
 * Compresses an image client-side and uploads it to Supabase Storage.
 *
 * @param file - The image file to upload
 * @param type - "avatar", "event" or "family" — determines bucket and sizing
 * @param path - Storage path **relative to the org prefix**, without
 *   extension (e.g. `profiles/${userId}/avatar` — build it with
 *   `relObjectPath()` from `@/lib/storagePaths`)
 * @returns The public URL of the uploaded image
 */
export async function uploadImage(
  file: File,
  type: ImageUploadType,
  path: string,
): Promise<string> {
  const config = CONFIG[type];

  const compressed = await imageCompression(file, {
    maxSizeMB: config.maxSizeMB,
    maxWidthOrHeight: config.maxWidthOrHeight,
    useWebWorker: true,
    fileType: "image/jpeg",
    initialQuality: 0.9,
  });

  const supabase = createClient();
  const fullPath = await resolveOrgPrefixedPath(supabase, "uploadImage", path);

  const { error } = await supabase.storage
    .from(config.bucket)
    .upload(fullPath, compressed, {
      contentType: "image/jpeg",
      upsert: true,
      cacheControl: "3600",
    });

  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }

  const { data } = supabase.storage.from(config.bucket).getPublicUrl(fullPath);
  return data.publicUrl;
}

/**
 * Deletes an uploaded image from Supabase Storage.
 *
 * @param type - Same bucket selector as uploadImage()
 * @param path - Storage path **relative to the org prefix**, without
 *   extension — the same value that was passed to uploadImage()
 * @returns `{ removed }` — whether Storage actually deleted an object.
 *   `remove()` returns the rows it deleted with `error: null`, so a key the
 *   RLS floor filtered out is indistinguishable from one that was never
 *   there: both resolve successfully with an empty array. Callers that need
 *   "the blob is gone" rather than "nothing addressable remains" must check
 *   this. Deliberately not a throw: a legacy pre-CWA-57 key is an accepted
 *   no-op (see app/admin/families/page.tsx and the re-key deferral in
 *   docs/security/tenancy-model.md), and throwing would regress every
 *   pre-CWA-57 photo removal during exactly the window this PR opens.
 */
export async function deleteImage(
  type: ImageUploadType,
  path: string,
): Promise<{ removed: boolean }> {
  const config = CONFIG[type];
  const supabase = createClient();
  const fullPath = await resolveOrgPrefixedPath(supabase, "deleteImage", path);

  const { data, error } = await supabase.storage
    .from(config.bucket)
    .remove([fullPath]);

  if (error) {
    throw new Error(`Delete failed: ${error.message}`);
  }

  const removed = (data?.length ?? 0) > 0;
  if (!removed) {
    // Either the object was already gone (legacy un-prefixed key, double
    // click) or the restrictive floor filtered it — an org-prefix bug, a
    // wrong bucket, or a capability lost since page load. All three are
    // silent from the caller's side, so leave a trail.
    console.warn(
      `deleteImage: no object removed at ${config.bucket}/${fullPath} — ` +
        "already absent (e.g. a legacy un-prefixed key), or filtered by storage RLS",
    );
  }
  return { removed };
}
