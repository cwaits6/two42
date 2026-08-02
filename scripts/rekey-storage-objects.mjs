#!/usr/bin/env node
// Re-key legacy storage objects onto the org-partitioned layout
// (CWA-57 / #328): `<org_id>/<kind>/<entity_id>/<file>`.
//
// This is deliberately an OPERATOR SCRIPT, not a migration: Supabase Storage
// keys the physical blob by bucket/name, so a SQL
// `UPDATE storage.objects SET name = …` renames the DB row and orphans the
// blob — every public URL derived from the new name would 404. The Storage
// `move()` API is the only operation that moves both, and it is HTTP-only.
//
// Idempotent: keys whose first segment is already a UUID (an org id) are
// skipped, so re-running after a partial failure is safe. Dry-run by
// default; pass --apply to mutate.
//
//   SUPABASE_URL=https://<project>.supabase.co \
//   SUPABASE_SECRET_KEY=<service key> \
//   node scripts/rekey-storage-objects.mjs [--apply] [--org <uuid>]
//
// The service key bypasses RLS (including the new restrictive storage
// floor) — that is what lets it touch the legacy un-prefixed keys that are
// invisible to every anon/authenticated principal. The org id is DERIVED
// from the organizations table, never hardcoded; with more than one org the
// script refuses to guess and requires --org, because legacy (pre-CWA-57)
// keys carry no org marker and can only have belonged to the single org
// that existed before partitioning.

import { createClient } from "@supabase/supabase-js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// legacy key shape → { kind, urlTable, urlColumn }
const LEGACY_SHAPES = [
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

const BUCKETS = ["avatars", "event-images"];

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const orgFlag = args.indexOf("--org");
const orgOverride = orgFlag === -1 ? null : args[orgFlag + 1];
if (orgFlag !== -1 && !UUID_RE.test(orgOverride ?? "")) {
  fail("--org requires a UUID argument");
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  fail("SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be set");
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

async function resolveOrgId() {
  const { data, error } = await supabase.from("organizations").select("id, slug");
  if (error) fail(`could not read organizations: ${error.message}`);
  if (orgOverride) {
    if (!data.some((o) => o.id === orgOverride)) {
      fail(`--org ${orgOverride} matches no organizations row`);
    }
    return orgOverride;
  }
  if (data.length === 0) fail("no organizations exist");
  if (data.length > 1) {
    fail(
      `multiple organizations exist (${data.map((o) => o.slug).join(", ")}); ` +
        "legacy keys carry no org marker, so pass --org <uuid> explicitly",
    );
  }
  return data[0].id;
}

// Storage list() is per-folder; walk it recursively. Folders come back as
// entries with a null id.
async function listAllObjects(bucket, prefix = "") {
  const names = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit, offset });
    if (error) fail(`list ${bucket}/${prefix}: ${error.message}`);
    for (const entry of data) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        names.push(...(await listAllObjects(bucket, path)));
      } else {
        names.push(path);
      }
    }
    if (data.length < limit) break;
    offset += limit;
  }
  return names;
}

function publicUrl(bucket, name) {
  return supabase.storage.from(bucket).getPublicUrl(name).data.publicUrl;
}

const orgId = await resolveOrgId();
console.log(`${apply ? "APPLY" : "DRY RUN"} — org ${orgId}`);

let moved = 0;
let skipped = 0;
let unrecognized = 0;

for (const bucket of BUCKETS) {
  const names = await listAllObjects(bucket);
  for (const name of names) {
    const segs = name.split("/");
    if (UUID_RE.test(segs[0])) {
      skipped += 1; // already org-prefixed — idempotency
      continue;
    }
    const shape = LEGACY_SHAPES.find((s) => s.bucket === bucket && s.match(segs));
    if (!shape) {
      unrecognized += 1;
      console.warn(`SKIP (unrecognized legacy shape): ${bucket}/${name}`);
      continue;
    }
    const newName = shape.rekey(orgId, segs);
    const oldUrl = publicUrl(bucket, name);
    const newUrl = publicUrl(bucket, newName);
    console.log(`MOVE ${bucket}/${name}`);
    console.log(`  -> ${bucket}/${newName}`);
    console.log(`  ${shape.urlTable}.${shape.urlColumn}: ${oldUrl} -> ${newUrl}`);
    if (!apply) {
      moved += 1;
      continue;
    }

    const { error: moveError } = await supabase.storage.from(bucket).move(name, newName);
    if (moveError) fail(`move ${bucket}/${name}: ${moveError.message}`);

    // Service-role query: the org filter IS the tenant boundary here, and
    // orgId came from the organizations table above, never from input alone.
    const { data: updatedRows, error: updateError } = await supabase
      .from(shape.urlTable)
      .update({ [shape.urlColumn]: newUrl })
      .eq("id", shape.entityId(segs))
      .eq("org_id", orgId)
      .eq(shape.urlColumn, oldUrl)
      .select("id");
    if (updateError) {
      fail(
        `object moved but URL update failed for ${shape.urlTable}.${shape.urlColumn} ` +
          `(entity ${shape.entityId(segs)}): ${updateError.message} — re-run to continue; ` +
          "the moved object is skipped as already-prefixed, fix this row by hand",
      );
    }
    if (updatedRows.length === 0) {
      console.warn(
        `  WARN: no ${shape.urlTable} row carried the old URL (already updated, or the entity was deleted)`,
      );
    }
    moved += 1;
  }
}

console.log(
  `${apply ? "moved" : "would move"} ${moved}, already-prefixed ${skipped}, unrecognized ${unrecognized}`,
);
if (!apply && moved > 0) {
  console.log("re-run with --apply to perform the moves");
}
