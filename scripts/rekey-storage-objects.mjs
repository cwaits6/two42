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
// Idempotent: keys already on the org-partitioned layout (a UUID first
// segment AND a known `<kind>` second segment — see isOrgPartitioned() in
// ./rekeyPlan.mjs for why the UUID alone is not enough) are skipped, so
// re-running after a partial failure is safe. Dry-run by default; pass
// --apply to mutate.
//
//   SUPABASE_URL=https://<project>.supabase.co \
//   SUPABASE_SECRET_KEY=<service key> \
//   node scripts/rekey-storage-objects.mjs [--apply] [--org <uuid>]
//                                          [--allow-unrecognized]
//
// Exits non-zero on any object it could not fully migrate (destination
// collision, URL row not updated, unrecognized shape) so a scripted run
// cannot read a partial migration as success.
//
// The service key bypasses RLS (including the new restrictive storage
// floor) — that is what lets it touch the legacy un-prefixed keys that are
// invisible to every anon/authenticated principal. The org id is DERIVED
// from the organizations table, never hardcoded; with more than one org the
// script refuses to guess and requires --org, because legacy (pre-CWA-57)
// keys carry no org marker and can only have belonged to the single org
// that existed before partitioning.

import { createClient } from "@supabase/supabase-js";
import { LEGACY_SHAPES, UUID_RE, classifyObject } from "./rekeyPlan.mjs";

const BUCKETS = ["avatars", "event-images"];

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const allowUnrecognized = args.includes("--allow-unrecognized");
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

// The URL base this script would mint, e.g.
// `https://<project>.supabase.co/storage/v1/object/public/avatars/`.
function publicUrlBase(bucket) {
  const probe = "__rekey_probe__";
  return publicUrl(bucket, probe).slice(0, -probe.length);
}

// Does the destination key already hold an object? Probed with list() rather
// than by matching move()'s error string, which is a third-party contract.
async function destinationExists(bucket, newName) {
  const segs = newName.split("/");
  const file = segs.pop();
  const { data, error } = await supabase.storage
    .from(bucket)
    .list(segs.join("/"), { search: file, limit: 1 });
  if (error) fail(`list ${bucket}/${segs.join("/")}: ${error.message}`);
  return data.some((entry) => entry.name === file);
}

// Pre-flight: the URL update below is guarded by `.eq(urlColumn, oldUrl)`,
// comparing a URL reconstructed from THIS process's SUPABASE_URL against
// whatever the browser persisted from NEXT_PUBLIC_SUPABASE_URL. Any
// divergence (custom storage domain, vanity vs. project-ref host, a
// hand-edited row) makes every move succeed and every update match 0 rows —
// an estate-wide, irreversible 404 with a zero exit code. One read per shape
// converts that into a clean abort before anything mutates.
//
// Service-role queries: `.eq("org_id", orgId)` is the tenant boundary, and
// orgId came from the organizations table above, never from input.
async function preflightUrlBase(orgId) {
  for (const shape of LEGACY_SHAPES) {
    const { data, error } = await supabase
      .from(shape.urlTable)
      .select(`id, ${shape.urlColumn}`)
      .eq("org_id", orgId)
      .not(shape.urlColumn, "is", null)
      .limit(1);
    if (error) {
      fail(`pre-flight read of ${shape.urlTable}.${shape.urlColumn}: ${error.message}`);
    }
    if (data.length === 0) continue; // nothing stored yet — nothing to disagree with
    const stored = data[0][shape.urlColumn];
    const base = publicUrlBase(shape.bucket);
    if (!stored.startsWith(base)) {
      fail(
        `${shape.urlTable}.${shape.urlColumn} stores URLs under a different base than this ` +
          `script would mint:\n  stored:   ${stored}\n  expected: ${base}…\n` +
          "Every move would succeed and every URL update would match 0 rows, 404ing the " +
          "estate irreversibly. Re-run with SUPABASE_URL set to the host the app writes " +
          "(NEXT_PUBLIC_SUPABASE_URL).",
      );
    }
  }
}

const orgId = await resolveOrgId();
console.log(`${apply ? "APPLY" : "DRY RUN"} — org ${orgId}`);
await preflightUrlBase(orgId);

let moved = 0;
let skipped = 0;
let otherOrg = 0;
let unrecognized = 0;
const collided = [];
const urlMisses = [];

for (const bucket of BUCKETS) {
  const names = await listAllObjects(bucket);
  for (const name of names) {
    const plan = classifyObject(bucket, name, orgId);
    if (plan.action === "skip") {
      if (plan.reason === "other-org") otherOrg += 1;
      else skipped += 1;
      continue;
    }
    if (plan.action === "unrecognized") {
      unrecognized += 1;
      console.warn(`SKIP (unrecognized legacy shape): ${bucket}/${name}`);
      continue;
    }
    const { shape, newName, entityId } = plan;
    const oldUrl = publicUrl(bucket, name);
    const newUrl = publicUrl(bucket, newName);
    console.log(`MOVE ${bucket}/${name}`);
    console.log(`  -> ${bucket}/${newName}`);
    console.log(`  ${shape.urlTable}.${shape.urlColumn}: ${oldUrl} -> ${newUrl}`);
    if (!apply) {
      moved += 1;
      continue;
    }

    // A destination that already exists is expected, not hypothetical: this
    // ships with the call-site rewrite, so from deploy onward the app writes
    // org-prefixed keys. The newer blob wins; leave the legacy one in place
    // and keep going rather than aborting the whole run mid-estate.
    if (await destinationExists(bucket, newName)) {
      collided.push(`${bucket}/${name} -> ${bucket}/${newName}`);
      console.warn(
        `  SKIP (destination already exists — newer blob wins): ${bucket}/${newName}\n` +
          `       stale legacy object left at ${bucket}/${name} — delete by hand`,
      );
      continue;
    }

    const { error: moveError } = await supabase.storage.from(bucket).move(name, newName);
    if (moveError) fail(`move ${bucket}/${name}: ${moveError.message}`);

    // Service-role query: the org filter IS the tenant boundary here, and
    // orgId came from the organizations table above, never from input alone.
    const { data: updatedRows, error: updateError } = await supabase
      .from(shape.urlTable)
      .update({ [shape.urlColumn]: newUrl })
      .eq("id", entityId)
      .eq("org_id", orgId)
      .eq(shape.urlColumn, oldUrl)
      .select("id");
    if (updateError) {
      fail(
        `object moved but URL update failed for ${shape.urlTable}.${shape.urlColumn} ` +
          `(entity ${entityId}): ${updateError.message} — re-run to continue; ` +
          "the moved object is skipped as already-prefixed, fix this row by hand",
      );
    }
    if (updatedRows.length === 0) {
      // Benign if the row was already updated or the entity was deleted;
      // damaging if the stored URL simply never matched — the blob has moved
      // and the row still points at the old key. Collected, not just warned:
      // a re-run cannot find it again (the object is now org-prefixed).
      urlMisses.push(`${shape.urlTable}.${shape.urlColumn} id=${entityId} (${bucket}/${newName})`);
      console.warn(
        `  WARN: no ${shape.urlTable} row carried the old URL (already updated, the entity ` +
          "was deleted, or the stored URL never matched — the blob has MOVED regardless)",
      );
    }
    moved += 1;
  }
}

console.log(
  `${apply ? "moved" : "would move"} ${moved}, already-prefixed ${skipped}, ` +
    `other-org prefix ${otherOrg}, collided ${collided.length}, ` +
    `url-not-updated ${urlMisses.length}, unrecognized ${unrecognized}`,
);
if (!apply && moved > 0) {
  console.log("re-run with --apply to perform the moves");
}

if (collided.length > 0) {
  console.error(`\n${collided.length} destination collision(s) — legacy blob left behind:`);
  for (const line of collided) console.error(`  ${line}`);
}
if (urlMisses.length > 0) {
  console.error(`\n${urlMisses.length} row(s) whose URL column was not updated — verify by hand:`);
  for (const line of urlMisses) console.error(`  ${line}`);
}
if (unrecognized > 0 && !allowUnrecognized) {
  console.error(
    `\n${unrecognized} object(s) matched no known legacy shape. They keep un-prefixed keys ` +
      "and are invisible to every client write path. Re-run with --allow-unrecognized to " +
      "acknowledge them.",
  );
}

const incomplete =
  collided.length > 0 || urlMisses.length > 0 || (unrecognized > 0 && !allowUnrecognized);
if (incomplete) process.exit(1);
