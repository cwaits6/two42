// Re-seals a church's sealed keys under the current records secret after a
// rotation. Imported by scripts/reseal-records-keys.mjs under Node's type
// stripping, so its one runtime import is the shared crypto module by relative
// path, and every other import is `import type`. Keep it that way.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../supabase/database.types";
import {
  intakeKeyLabel,
  openKey,
  type RecordsSecrets,
  sealedWithCurrentSecret,
  sealKey,
} from "../../../supabase/functions/_shared/records-crypto.ts";

export type ResealAction = "noop" | "reseal" | "unopenable";
export type ResealOutcome = "resealed" | "changed meanwhile" | "failed";
export type SealPlan = { action: "noop" } | { action: "reseal"; next: string } | { action: "unopenable" };

export interface SealedKeyResult {
  orgId: string;
  provider: string;
  key: "read key" | "write key";
  action: ResealAction;
  /** Set only when the run applied a reseal. */
  outcome?: ResealOutcome;
}

export function planSeal(secrets: RecordsSecrets, orgId: string, label: string, ciphertext: string): SealPlan {
  let opened: string;
  try {
    opened = openKey(secrets, orgId, label, ciphertext);
  } catch {
    return { action: "unopenable" };
  }
  if (sealedWithCurrentSecret(secrets, ciphertext)) return { action: "noop" };
  return { action: "reseal", next: sealKey(secrets, orgId, label, opened) };
}

type SealedTable = "records_connections" | "records_intake_settings";

/**
 * Guarded on the ciphertext it read, so a key a church admin replaced after
 * the read is left alone; a filtered update that matches nothing still
 * reports success, so the returned rows are counted.
 */
async function writeSeal(
  client: SupabaseClient<Database>,
  table: SealedTable,
  orgId: string,
  old: string,
  next: string,
): Promise<ResealOutcome> {
  const { data, error } = await client
    .from(table)
    .update({ key_ciphertext: next })
    .eq("org_id", orgId)
    .eq("key_ciphertext", old)
    .select("org_id");
  if (error) return "failed";
  return data.length === 1 ? "resealed" : "changed meanwhile";
}

/** One church's read key and write key; throws when either can't be read. */
export async function resealOrg(
  client: SupabaseClient<Database>,
  secrets: RecordsSecrets,
  orgId: string,
  { apply }: { apply: boolean },
): Promise<SealedKeyResult[]> {
  const connection = await client
    .from("records_connections")
    .select("provider, key_ciphertext")
    .eq("org_id", orgId)
    .maybeSingle();
  if (connection.error) throw new Error("records keys read failed");
  const intake = await client
    .from("records_intake_settings")
    .select("key_ciphertext")
    .eq("org_id", orgId)
    .maybeSingle();
  if (intake.error) throw new Error("records keys read failed");

  const sealed: { table: SealedTable; key: SealedKeyResult["key"]; label: string | null; ciphertext: string }[] = [];
  const provider = connection.data?.provider ?? "unknown";
  if (connection.data) {
    sealed.push({ table: "records_connections", key: "read key", label: provider, ciphertext: connection.data.key_ciphertext });
  }
  if (intake.data) {
    // The write key's provider is its connection's, so without one its label is unknown.
    const label = connection.data ? intakeKeyLabel(provider) : null;
    sealed.push({ table: "records_intake_settings", key: "write key", label, ciphertext: intake.data.key_ciphertext });
  }

  const results: SealedKeyResult[] = [];
  for (const { table, key, label, ciphertext } of sealed) {
    const plan: SealPlan = label ? planSeal(secrets, orgId, label, ciphertext) : { action: "unopenable" };
    const result: SealedKeyResult = { orgId, provider, key, action: plan.action };
    if (apply && plan.action === "reseal") result.outcome = await writeSeal(client, table, orgId, ciphertext, plan.next);
    results.push(result);
  }
  return results;
}
