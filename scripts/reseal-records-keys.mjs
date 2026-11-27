#!/usr/bin/env node
// Re-seals every church's church records keys, the read key and the write key,
// under the current RECORDS_KEY_SECRET after the secret is rotated. The secret
// lives outside the database, so no migration can do this.
//
//   SUPABASE_URL=https://<project>.supabase.co \
//   SUPABASE_SECRET_KEY=<service key> \
//   RECORDS_KEY_SECRET=<new base64> RECORDS_KEY_SECRET_PREVIOUS=<old base64> \
//   node scripts/reseal-records-keys.mjs [--apply]
//
// Dry run by default: one line per sealed key, by church id and provider, as
// reseal, noop or unopenable. --apply re-seals what opens under the previous
// secret; each write is guarded on the value it read (see
// lib/integrations/records/reseal.ts). Rerunnable. Never prints a key or its
// ciphertext. Exits non-zero while any key is unopenable, unread or unwritten.

import { createClient } from "@supabase/supabase-js";
import { resealOrg } from "../lib/integrations/records/reseal.ts";
import { fetchAll } from "../lib/supabase/fetchAll.ts";
import { parseRecordsSecrets, recordsKeyId } from "../supabase/functions/_shared/records-crypto.ts";

const PAGE = 200;

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

const apply = process.argv.slice(2).includes("--apply");

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) fail("SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be set");
const { secrets, malformed } = parseRecordsSecrets((name) => process.env[name]);
if (malformed) fail(`${malformed} must be 32 bytes of base64`);
if (!secrets) fail("RECORDS_KEY_SECRET must be set to the secret the app uses");

console.log(
  `current secret ${recordsKeyId(secrets.current)}, previous secret ${secrets.previous ? recordsKeyId(secrets.previous) : "none"}`,
);

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const { data: orgs, error } = await fetchAll(
  (from, to) => supabase.from("organizations").select("id").order("id").range(from, to),
  PAGE,
);
if (error) fail(`could not read organizations (${error.code})`);

let problems = 0;
for (const { id: orgId } of orgs) {
  let results;
  try {
    results = await resealOrg(supabase, secrets, orgId, { apply });
  } catch {
    console.error(`org ${orgId}: could not read its keys`);
    problems += 1;
    continue;
  }
  for (const r of results) {
    console.log(`org ${r.orgId} ${r.provider} ${r.key}: ${r.action}${r.outcome ? ` → ${r.outcome}` : ""}`);
    if (r.action === "unopenable" || (r.outcome && r.outcome !== "resealed")) problems += 1;
  }
}

if (!apply) console.log("Dry run: nothing was written. Pass --apply to re-seal.");
if (problems > 0) {
  console.error(
    `${problems} key(s) need attention: rerun, or have that church admin enter the key again (docs-site Run → Environment, "Rotating the records secret")`,
  );
  process.exit(1);
}
