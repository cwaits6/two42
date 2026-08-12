// Pure classification half of scripts/rekey-storage-objects.mjs (CWA-57).
//
// Split out deliberately: the entry point executes `process.env` reads and
// `createClient()` at module top level, so nothing in it is importable from a
// test — the same reason CLAUDE.md requires edge-function logic to live in
// `_shared/`. Everything here is synchronous, dependency-free, and covered by
// scripts/rekeyPlan.test.mjs.

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The `<kind>` segment of the org-partitioned layout — mirrors StorageKind in
// lib/storagePaths.ts and the `(storage.foldername(name))[2]` predicates in
// 20260803000000_storage_org_partitioned_policies.sql. Renaming a literal in
// any one of those three places silently breaks the other two.
export const ORG_KINDS = new Set([
  "profiles",
  "family-members",
  "families",
  "events",
]);

// Legacy (pre-CWA-57) key shapes. Each entry:
//   bucket    — the storage bucket the shape can appear in
//   match     — (segs) => boolean, tested against the "/"-split key
//   rekey     — (orgId, segs) => the org-partitioned key to move to
//   urlTable  — the table whose row holds the public URL of this object
//   urlColumn — the column on that table (updated in the same pass)
//   entityId  — (segs) => the urlTable primary key this object belongs to
// There is deliberately no `event-images` entry: the bucket exists for a
// planned feature and no call site has ever written to it, so any object
// found there is genuinely unrecognized rather than an unhandled legacy shape.
export const LEGACY_SHAPES = [
  {
    bucket: "avatars",
    // families/<family_id>/photo.jpg
    match: (segs) => segs.length === 3 && segs[0] === "families",
    rekey: (org, segs) => [org, "families", segs[1], segs[2]].join("/"),
    urlTable: "family_units",
    urlColumn: "photo_url",
    entityId: (segs) => segs[1],
  },
  {
    bucket: "avatars",
    // family-members/<family_member_id>/avatar.jpg
    match: (segs) => segs.length === 3 && segs[0] === "family-members",
    rekey: (org, segs) => [org, "family-members", segs[1], segs[2]].join("/"),
    urlTable: "family_members",
    urlColumn: "avatar_url",
    entityId: (segs) => segs[1],
  },
  {
    bucket: "avatars",
    // <profile_id>/avatar.jpg  (the original un-kinded layout)
    match: (segs) => segs.length === 2 && UUID_RE.test(segs[0]),
    rekey: (org, segs) => [org, "profiles", segs[0], segs[1]].join("/"),
    urlTable: "profiles",
    urlColumn: "avatar_url",
    entityId: (segs) => segs[0],
  },
];

/**
 * True when a key is already on the org-partitioned layout
 * `<org_id>/<kind>/<entity_id>/<file>`.
 *
 * "Starts with a UUID" is NOT sufficient and was the original bug: the legacy
 * profile-avatar layout is `<profile_id>/avatar.jpg`, whose first segment is
 * also a UUID — just never an *org* id. Testing only `UUID_RE.test(segs[0])`
 * classified every member avatar as already-done and reported the estate
 * clean while migrating none of it. The `<kind>` segment is what actually
 * distinguishes the two layouts.
 */
export function isOrgPartitioned(segs) {
  return segs.length >= 4 && UUID_RE.test(segs[0]) && ORG_KINDS.has(segs[1]);
}

/**
 * Classify one object key. Pure — no I/O, no ordering dependence.
 *
 * @param {string} bucket
 * @param {string} name    the full object key
 * @param {string} orgId   the org being re-keyed into
 * @returns {{action: "skip", reason: "already-prefixed" | "other-org"}
 *          | {action: "rekey", shape: object, newName: string, entityId: string}
 *          | {action: "unrecognized"}}
 */
export function classifyObject(bucket, name, orgId) {
  const segs = name.split("/");
  if (isOrgPartitioned(segs)) {
    // Already partitioned, but into a *different* org — a partially re-keyed
    // multi-org estate. Never a candidate to move, and reported separately so
    // it is not silently folded into "nothing to do for this run".
    return {
      action: "skip",
      reason: segs[0] === orgId ? "already-prefixed" : "other-org",
    };
  }
  const shape = LEGACY_SHAPES.find((s) => s.bucket === bucket && s.match(segs));
  if (!shape) {
    return { action: "unrecognized" };
  }
  return {
    action: "rekey",
    shape,
    newName: shape.rekey(orgId, segs),
    entityId: shape.entityId(segs),
  };
}
