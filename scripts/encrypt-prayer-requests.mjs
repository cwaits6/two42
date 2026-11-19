#!/usr/bin/env node
// Converts existing prayer requests to the form the app writes: the text
// sealed into body_ciphertext, and an anonymous request's author_id replaced
// by author_hash. During a key rotation it also moves text and hashes, of
// requests and of comments on them, from the _PREVIOUS keys onto the current
// ones. The keys live outside the database,
// so no migration can do this.
//
//   SUPABASE_URL=https://<project>.supabase.co \
//   SUPABASE_SECRET_KEY=<service key> \
//   PRAYER_BODY_KEY=<base64> PRAYER_AUTHOR_KEY=<base64> \
//   node scripts/encrypt-prayer-requests.mjs [--apply] [--org <uuid>]
//
// Dry run by default: it prints the key ids and what it would change. Opening
// every sealed row proves the body key, and if any fails to open nothing is
// written. Only a hash the app wrote under the
// given author key proves that key, and only the churches the run covers are
// read for it (with --org, that one church): until one exists there the script
// writes no author hash. Those rows are held, counted, and fail the run, while
// the rest still convert. Rerunnable: a row already in the current form is left
// alone, so a run after a partial one picks up what is left. Each write is
// guarded on the row as it was read (see lib/prayer/backfill.ts): a row the app
// changed in the meantime is counted and left for the next run. Prints counts per church and table, never
// request text or anyone's id, and exits non-zero on anything it could not convert.

import { createClient } from "@supabase/supabase-js";
import { commentAsStoredRow, writeCommentPlan, writePlan } from "../lib/prayer/backfill.ts";
import { keyId, parsePrayerKeys, planRow, selectWrites } from "../lib/prayer/crypto.ts";
import { fetchAll } from "../lib/supabase/fetchAll.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 200;
const ROW_COLUMNS = "id, org_id, body, body_ciphertext, is_anonymous, author_id, author_hash, updated_at";
const COMMENT_COLUMNS = "id, org_id, body_ciphertext, hide_name, writer_id, writer_hash";

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const orgFlag = args.indexOf("--org");
const orgOnly = orgFlag === -1 ? null : args[orgFlag + 1];
if (orgFlag !== -1 && !UUID_RE.test(orgOnly ?? "")) fail("--org requires a UUID argument");

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) fail("SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be set");
const keys = parsePrayerKeys(process.env);
if (!keys) fail("PRAYER_BODY_KEY and PRAYER_AUTHOR_KEY must each be 32 bytes of base64, and any _PREVIOUS key too");

console.log(`body key ${keyId(keys.body.current)}, author key ${keyId(keys.author.current)}`);

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

async function orgIds() {
  if (orgOnly) {
    const { data, error } = await supabase.from("organizations").select("id").eq("id", orgOnly).maybeSingle();
    if (error) fail(`could not read organizations (${error.code})`);
    if (!data) fail(`--org ${orgOnly} matches no organizations row`);
    return [orgOnly];
  }
  const rows = await readAll(
    (from, to) => supabase.from("organizations").select("id").order("id").range(from, to),
    "organizations",
  );
  return rows.map((o) => o.id);
}

async function readAll(page, what) {
  const { data, error } = await fetchAll(page, PAGE);
  if (error) fail(`could not read ${what} (${error.code})`);
  return data;
}

// Only a hash under the previous author key needs the members, to find whose it is.
async function memberIds(orgId) {
  if (!keys.author.previous) return [];
  const rows = await readAll(
    (from, to) => supabase.from("profiles").select("id").eq("org_id", orgId).order("id").range(from, to),
    "the church's people",
  );
  return rows.map((r) => r.id);
}

// `row` is what planRow and the key proof read; `stored` is the row as read, for the guarded write.
async function planChurch(orgId) {
  const requests = await readAll(
    (from, to) =>
      supabase.from("prayer_requests").select(ROW_COLUMNS).eq("org_id", orgId).order("id").range(from, to),
    "prayer requests",
  );
  const comments = await readAll(
    (from, to) =>
      supabase.from("prayer_comments").select(COMMENT_COLUMNS).eq("org_id", orgId).order("id").range(from, to),
    "prayer comments",
  );
  const members = await memberIds(orgId);
  const plan = (table, stored, row) => ({ table, stored, row, plan: planRow(row, keys, members) });
  return [
    ...requests.map((row) => plan("requests", row, row)),
    ...comments.map((row) => plan("comments", row, commentAsStoredRow(row))),
  ];
}

function summarise(planned) {
  const counts = { requests: {}, comments: {} };
  for (const { table, plan } of planned) {
    const keysOf = plan.action === "write" ? [...plan.steps, ...(plan.unmatched ? ["unmatched"] : [])] : [plan.action];
    for (const k of keysOf) counts[table][k] = (counts[table][k] ?? 0) + 1;
  }
  return counts;
}

const write = (item) =>
  item.table === "comments"
    ? writeCommentPlan(supabase, item.stored, item.plan)
    : writePlan(supabase, item.stored, item.plan);

const format = (counts) =>
  Object.entries(counts)
    .map(([k, n]) => `${k} ${n}`)
    .join(", ") || "no rows";

// Every church the run covers is planned before anything is written, because a
// hash under the author key in any one of them is what lets the others be hashed.
const churches = [];
for (const orgId of await orgIds()) churches.push({ orgId, planned: await planChurch(orgId) });
const { proven, unopened, churches: selected } = selectWrites(keys, churches);
if (unopened > 0) {
  console.error(
    `${unopened} sealed row(s) did not open under body key ${keyId(keys.body.current)}: nothing will be written until every one opens (docs/security/prayer-encryption.md)`,
  );
}
if (!proven) {
  console.error(
    `no request holds a hash under author key ${keyId(keys.author.current)}: author hashes are held until the app writes one (docs/security/prayer-encryption.md)`,
  );
}

let problems = 0;
for (const [i, { orgId, planned }] of churches.entries()) {
  const counts = summarise(planned);
  const { write: writes, held } = selected[i];
  problems += (counts.requests.error ?? 0) + (counts.comments.error ?? 0);
  console.log(
    `org ${orgId}: requests ${format(counts.requests)}; comments ${format(counts.comments)}${held.length ? `; ${held.length} held` : ""}`,
  );
  if (!apply) {
    problems += held.length;
    continue;
  }

  const outcomes = {};
  for (const item of writes) {
    const outcome = await write(item);
    outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
  }
  problems += (outcomes.failed ?? 0) + (outcomes["changed meanwhile"] ?? 0);
  // An unmatched hash stays as it is for good, so it is not left to convert.
  const left = (await planChurch(orgId)).filter((p) => !["noop", "unmatched"].includes(p.plan.action)).length;
  problems += left;
  console.log(`org ${orgId}: ${format(outcomes)}; ${left} left to convert`);
}

if (!apply) console.log("Dry run: nothing was written. Pass --apply to convert.");
if (problems > 0) {
  console.error(
    selected.every((c) => c.held.length === 0)
      ? `${problems} row(s) need attention: rerun, or see docs/security/prayer-encryption.md`
      : `${problems} row(s) need attention: post one anonymous request through the app, check its key id, then rerun (docs/security/prayer-encryption.md)`,
  );
  process.exit(1);
}
