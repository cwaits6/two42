// Which of a person's details came from the church's records, for the profile
// form. Read on the signed-in person's own request client, so RLS decides: a
// member reads their own sources and a church admin anyone's in their church.
// Imports next/headers through @/lib/supabase/server; never import it from a
// "use client" module.
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";
import type { ProfileRecords } from "./labels";
import { recordsIntegrationEnabled } from "./enabled";

/**
 * Null when the integration is off or the read fails: the form then shows no
 * labels, and a locked field is still kept by the database.
 */
export async function readProfileRecords(profileId: string): Promise<ProfileRecords | null> {
  if (!recordsIntegrationEnabled()) return null;
  const supabase = await createClient();
  const [settings, values, notice] = await Promise.all([
    supabase.from("records_field_settings").select("field, mode"),
    supabase.from("records_field_values").select("field, state, church_value").eq("profile_id", profileId),
    supabase.from("records_person_state").select("notice_filled_at, notice_seen_at").eq("profile_id", profileId).maybeSingle(),
  ]);
  const error = settings.error ?? values.error ?? notice.error;
  if (error) {
    logError("Church records labels read failed", error, { step: "records_labels" });
    return null;
  }
  return {
    settings: Object.fromEntries((settings.data ?? []).map((row) => [row.field, row.mode])),
    values: Object.fromEntries(
      (values.data ?? []).map((row) => [row.field, { state: row.state, churchValue: row.church_value }]),
    ),
    noticeDue: !!notice.data?.notice_filled_at && !notice.data.notice_seen_at,
  } as ProfileRecords;
}
