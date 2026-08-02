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
