import imageCompression from "browser-image-compression";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { AVATAR_EDGE } from "@/lib/avatarCrop";
import { resolveRequestOrgId } from "@/lib/org";
import {
  SIGNED_URL_TTL_SECONDS,
  groupPathsByBucket,
  orgObjectPath,
  parseStoragePublicUrl,
} from "@/lib/storagePaths";
import { logError, logWarn, stepOf } from "@/lib/log";

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
    maxWidthOrHeight: AVATAR_EDGE,
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

// Every object key is org-partitioned: the caller passes a key
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
  const orgId = await resolveRequestOrgId(supabase, { label });
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
    logError("uploadImage: upload failed", error, { step: stepOf(config.bucket) });
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
 *   this. Deliberately not a throw: a legacy un-prefixed key is an accepted
 *   no-op (see app/admin/families/HouseholdsManager.tsx and the re-key deferral in
 *   docs/security/tenancy-model.md), and throwing would regress every
 *   legacy photo removal during exactly the window this change opens.
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
    logError("deleteImage: remove failed", error, { step: stepOf(config.bucket) });
    throw new Error(`Delete failed: ${error.message}`);
  }

  const removed = (data?.length ?? 0) > 0;
  if (!removed) {
    // Either the object was already gone (legacy un-prefixed key, double
    // click) or the restrictive floor filtered it — an org-prefix bug, a
    // wrong bucket, or a capability lost since page load. All three are
    // silent from the caller's side, so leave a trail.
    logWarn(
      "deleteImage: no object removed — already absent (e.g. a legacy un-prefixed key), or filtered by storage RLS",
      undefined,
      { step: stepOf(config.bucket) },
    );
  }
  return { removed };
}

// ── Signed reads ────────────────────────────────────────────────────────────
// Both buckets are private, so a stored public-URL string no longer serves as
// an <img src> directly — it must be exchanged for a signed URL whose minting
// the org-scoped SELECT policies gate. These are the BROWSER-context helpers
// ("use client" components); server components and API routes use the
// mirrors in lib/storageRead.ts. Both own their client construction and
// deliberately never accept a SupabaseClient parameter: storage signing has
// no org_id predicate for a callee to re-validate, so a passed-in service
// client would mint cross-tenant URLs with nothing to stop it (the Tier C
// shape in CLAUDE.md / scripts/README.md).

/**
 * Exchanges one stored public-URL string for a signed URL. Fail-soft: a
 * malformed value, an un-rekeyed legacy object, or a transient Storage error
 * logs a warning and resolves `null` — a broken avatar must not break the
 * page around it.
 */
export async function mintSignedUrl(
  url: string | null | undefined,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  if (!url) return null;
  const parsed = parseStoragePublicUrl(url);
  if (!parsed) {
    // A signed URL's query string carries a bearer token, so the address is
    // not logged.
    logWarn("mintSignedUrl: unparseable storage URL");
    return null;
  }
  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, ttlSeconds);
  if (error || !data?.signedUrl) {
    logWarn("mintSignedUrl: signing failed", error ?? undefined, { step: stepOf(parsed.bucket) });
    return null;
  }
  return data.signedUrl;
}

/**
 * Batch variant: one `createSignedUrls()` call per bucket, results
 * reassembled into the input's slots (nulls stay null, per-item failures
 * become null). Reassembly is keyed by the response's `path` field, never by
 * array position — the response order is Supabase's, not the caller's.
 */
export async function mintSignedUrls(
  urls: Array<string | null | undefined>,
  ttlSeconds: number = SIGNED_URL_TTL_SECONDS,
): Promise<Array<string | null>> {
  const results: Array<string | null> = urls.map(() => null);
  const groups = groupPathsByBucket(urls);
  if (groups.size === 0) return results;
  const supabase = createClient();
  await Promise.all(
    Array.from(groups, async ([bucket, { indices, paths }]) => {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrls(paths, ttlSeconds);
      if (error || !data) {
        logWarn("mintSignedUrls: batch signing failed", error ?? undefined, { step: stepOf(bucket) });
        return;
      }
      const byPath = new Map<string, string>();
      for (const entry of data) {
        if (entry.error || !entry.signedUrl) {
          logWarn("mintSignedUrls: signing failed", entry.error ?? undefined, { step: stepOf(bucket) });
          continue;
        }
        if (entry.path) byPath.set(entry.path, entry.signedUrl);
      }
      indices.forEach((slot, i) => {
        results[slot] = byPath.get(paths[i]) ?? null;
      });
    }),
  );
  return results;
}
