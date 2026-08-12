// Storage object-key convention (CWA-57 / #328). Every object key is
// org-partitioned: `<org_id>/<kind>/<entity_id>/<file>` — the first path
// segment is what the restrictive "org isolation" policy on storage.objects
// checks against app_request_org_id() (see
// 20260803000000_storage_org_partitioned_policies.sql). This module is the
// one place the convention is encoded: call sites build relative keys with
// relObjectPath(), and lib/uploadImage.ts prefixes the org via
// orgObjectPath(). Deliberately dependency-free so it runs in vitest's node
// environment.

export type StorageKind = "profiles" | "family-members" | "families" | "events";

export type StorageBucket = "avatars" | "event-images";

/**
 * Signed-URL lifetime (CWA-59 / #333). One hour matches the upload path's
 * `cacheControl: "3600"` (lib/uploadImage.ts), so a signed URL never outlives
 * the cache freshness it promises and vice versa. Avatars render on nearly
 * every page, so re-mint cost matters: 1h means a typical session mints once
 * per page load cycle, while a leaked or forwarded URL goes dead the same
 * day instead of persisting forever like the old public URLs.
 */
export const SIGNED_URL_TTL_SECONDS = 3600;

function assertSegment(value: string, label: string): string {
  const segment = value.trim();
  if (!segment) {
    throw new Error(`storagePaths: ${label} must not be empty`);
  }
  if (segment.includes("/")) {
    // A "/" would shift every following path segment, silently breaking the
    // <org>/<kind>/<entity> layout the storage RLS policies parse.
    throw new Error(`storagePaths: ${label} must not contain "/"`);
  }
  return segment;
}

/**
 * Relative object key (no org prefix) — what call sites pass to
 * uploadImage()/deleteImage(), e.g. `profiles/<userId>/avatar`.
 */
export function relObjectPath(
  kind: StorageKind,
  entityId: string,
  file: string,
): string {
  return `${kind}/${assertSegment(entityId, "entityId")}/${assertSegment(file, "file")}`;
}

/**
 * Full object key: `<orgId>/<kind>/<entityId>/<file>`. Throws on an empty or
 * "/"-bearing orgId — a silently-empty org would produce `/profiles/…`,
 * whose foldername[1] is '' and which the RLS floor denies with a confusing
 * runtime error; failing loudly here is better.
 */
export function orgObjectPath(orgId: string, relPath: string): string {
  return `${assertSegment(orgId, "orgId")}/${relPath}`;
}

// Matches what getPublicUrl() has always returned and what the URL columns
// (profiles.avatar_url, family_units.photo_url, family_members.avatar_url)
// store — host-agnostic on purpose so the same parser works against the
// local stack and any prod project ref. The rekey script
// (scripts/rekey-storage-objects.mjs) writes back this exact shape too.
const PUBLIC_URL_RE =
  /\/storage\/v1\/object\/public\/(avatars|event-images)\/([^?#]+)/;

/**
 * Recovers `{bucket, path}` from a stored public-URL string so the signing
 * helpers can mint an RLS-gated signed URL for it (CWA-59 / #333). Returns
 * `null` — never throws — for a malformed or foreign value: this parses DB
 * data this module didn't produce, and one bad row must degrade to a missing
 * image, not crash a page render.
 */
export function parseStoragePublicUrl(
  url: string,
): { bucket: StorageBucket; path: string } | null {
  const match = PUBLIC_URL_RE.exec(url);
  if (!match) return null;
  return { bucket: match[1] as StorageBucket, path: match[2] };
}

/**
 * Groups parseable URLs by bucket for batched `createSignedUrls()` calls,
 * remembering each input's original array index so results can be
 * reassembled into the caller's slots. Nulls, undefineds, and unparseable
 * strings are simply absent from the output — their slots stay `null` on
 * reassembly.
 */
export function groupPathsByBucket(
  urls: Array<string | null | undefined>,
): Map<StorageBucket, { indices: number[]; paths: string[] }> {
  const groups = new Map<StorageBucket, { indices: number[]; paths: string[] }>();
  urls.forEach((url, index) => {
    if (!url) return;
    const parsed = parseStoragePublicUrl(url);
    if (!parsed) return;
    let group = groups.get(parsed.bucket);
    if (!group) {
      group = { indices: [], paths: [] };
      groups.set(parsed.bucket, group);
    }
    group.indices.push(index);
    group.paths.push(parsed.path);
  });
  return groups;
}
