// Server-context signed reads (CWA-59 / #333). Both storage buckets are
// private, so stored public-URL strings (profiles.avatar_url,
// family_units.photo_url, family_members.avatar_url) must be exchanged for
// signed URLs before they reach an <img src> or an API response; minting is
// gated by the org-scoped SELECT policies on storage.objects.
//
// This module imports @/lib/supabase/server and therefore next/headers —
// NEVER import it from a "use client" module (it would break the client
// bundle); browser components use the mirrors in lib/uploadImage.ts.
// Both mirrors own their client construction and deliberately never accept a
// SupabaseClient parameter: storage signing has no org_id predicate for a
// callee to re-validate, so a passed-in service client would mint
// cross-tenant URLs with nothing to stop it (the Tier C shape in CLAUDE.md /
// scripts/README.md). A caller that needs a specific org context (e.g. a
// public per-org route) should grow an `orgSlug?: string` parameter threaded
// to `createClient(orgSlug)` — never a client object.

import { createClient } from "@/lib/supabase/server";
import {
  SIGNED_URL_TTL_SECONDS,
  groupPathsByBucket,
  parseStoragePublicUrl,
} from "@/lib/storagePaths";

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
    console.warn(`mintSignedUrl: unparseable storage URL ${url}`);
    return null;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, ttlSeconds);
  if (error || !data?.signedUrl) {
    console.warn(
      `mintSignedUrl: signing failed for ${parsed.bucket}/${parsed.path} — ` +
        (error?.message ?? "no signed URL returned"),
    );
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
  const supabase = await createClient();
  await Promise.all(
    Array.from(groups, async ([bucket, { indices, paths }]) => {
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrls(paths, ttlSeconds);
      if (error || !data) {
        console.warn(
          `mintSignedUrls: batch signing failed for ${bucket} — ` +
            (error?.message ?? "no data returned"),
        );
        return;
      }
      const byPath = new Map<string, string>();
      for (const entry of data) {
        if (entry.error || !entry.signedUrl) {
          console.warn(
            `mintSignedUrls: signing failed for ${bucket}/${entry.path} — ` +
              (entry.error ?? "no signed URL returned"),
          );
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
