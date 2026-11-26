// Which of people's details came from the church's records, for the forms that
// edit them. Read on the signed-in person's own request client, so RLS
// decides: a member reads their own sources, a household manager those of the
// people they can edit, and a church admin anyone's in their church.
// Imports next/headers through @/lib/supabase/server; never import it from a
// "use client" module.
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";
import type { ProfileRecords } from "./labels";
import { recordsIntegrationEnabled } from "./enabled";

/**
 * Each requested person's records state; every one is present, with no
 * values when nothing of theirs came from the records. Not ok when the read
 * failed: a form shown without it would offer a locked field for editing and
 * the database would quietly keep the church's value, so the caller shows
 * its error state instead.
 */
export type RecordsRead = { ok: true; byProfile: Record<string, ProfileRecords> } | { ok: false };

/** `noticeFor` is the signed-in person, the only one whose notice anyone reads. */
export async function readProfileRecords(profileIds: string[], noticeFor?: string): Promise<RecordsRead> {
  const empty = (): ProfileRecords => ({ settings: {}, values: {}, noticeDue: false });
  if (!recordsIntegrationEnabled() || profileIds.length === 0) {
    return { ok: true, byProfile: Object.fromEntries(profileIds.map((id) => [id, empty()])) };
  }
  const supabase = await createClient();
  const [settings, values, notice] = await Promise.all([
    supabase.from("records_field_settings").select("field, mode"),
    supabase.from("records_field_values").select("profile_id, field, state, church_value").in("profile_id", profileIds),
    noticeFor
      ? supabase
          .from("records_person_state")
          .select("notice_filled_at, notice_seen_at")
          .eq("profile_id", noticeFor)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  const error = settings.error ?? values.error ?? notice.error;
  if (error) {
    logError("Church records labels read failed", error, { step: "records_labels" });
    return { ok: false };
  }
  const fieldSettings = Object.fromEntries((settings.data ?? []).map((row) => [row.field, row.mode]));
  const byProfile: Record<string, ProfileRecords> = {};
  for (const id of profileIds) {
    byProfile[id] = {
      settings: fieldSettings,
      values: {},
      noticeDue: id === noticeFor && !!notice.data?.notice_filled_at && !notice.data.notice_seen_at,
    } as ProfileRecords;
  }
  for (const row of values.data ?? []) {
    const person = byProfile[row.profile_id];
    if (person) {
      (person.values as Record<string, unknown>)[row.field] = { state: row.state, churchValue: row.church_value };
    }
  }
  return { ok: true, byProfile };
}

/** The household's anniversary as it came from the records: anyone's in the household will do, the trigger keeps them alike. */
export function householdAnniversary(read: Record<string, ProfileRecords>): ProfileRecords | null {
  return Object.values(read).find((records) => records.values.anniversary) ?? null;
}
