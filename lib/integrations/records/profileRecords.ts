// Which of people's details came from the church's records, for the forms that
// edit them. Read on the signed-in person's own request client, so RLS
// decides: a member reads their own sources, a household manager those of the
// people they can edit, and a church admin anyone's in their church.
// Imports next/headers through @/lib/supabase/server; never import it from a
// "use client" module.
import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";
import type { ProfileRecords } from "./labels";

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
  if (profileIds.length === 0) {
    return { ok: true, byProfile: Object.fromEntries(profileIds.map((id) => [id, empty()])) };
  }
  const supabase = await createClient();
  const [settings, values, notice] = await Promise.all([
    supabase.from("records_field_settings").select("field, mode"),
    // The anniversary's source is the household's; a person's own row of it is no longer kept up to date.
    supabase
      .from("records_field_values")
      .select("profile_id, field, state, church_value")
      .in("profile_id", profileIds)
      .neq("field", "anniversary"),
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

/**
 * The household's own details from the records: its address, home phone and
 * anniversary. Null when none came from the records; not ok when the read
 * failed, as for people.
 */
export async function readHouseholdRecords(
  familyId: string,
): Promise<{ ok: true; records: ProfileRecords | null } | { ok: false }> {
  const supabase = await createClient();
  const [settings, values, anniversary] = await Promise.all([
    supabase.from("records_field_settings").select("field, mode"),
    supabase.from("records_household_values").select("field, state, church_value").eq("family_id", familyId),
    supabase.from("records_household_anniversary").select("state, church_value").eq("family_id", familyId).maybeSingle(),
  ]);
  const error = settings.error ?? values.error ?? anniversary.error;
  if (error) {
    logError("Church records household labels read failed", error, { step: "records_household_labels" });
    return { ok: false };
  }
  const own = Object.fromEntries(
    [...(values.data ?? []), ...(anniversary.data ? [{ field: "anniversary", ...anniversary.data }] : [])].map((row) => [
      row.field,
      { state: row.state, churchValue: row.church_value },
    ]),
  ) as ProfileRecords["values"];
  if (Object.keys(own).length === 0) return { ok: true, records: null };
  return {
    ok: true,
    records: {
      settings: Object.fromEntries((settings.data ?? []).map((row) => [row.field, row.mode])),
      values: own,
      noticeDue: false,
    },
  };
}

export interface SuggestedChild {
  id: string;
  first_name: string;
  last_name: string;
  birth_month: number | null;
  birth_day: number | null;
  graduation_year: number | null;
}

/**
 * The children the church's records suggest for this household. RLS shows
 * them only to its primary and spouse, and only while the church suggests
 * children. A failed read shows no card: nothing is offered wrongly.
 */
export async function readSuggestedChildren(familyId: string): Promise<SuggestedChild[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("records_child_suggestions")
    .select("id, first_name, last_name, birth_month, birth_day, graduation_year")
    .eq("family_id", familyId)
    .eq("state", "open")
    .order("first_name");
  if (error) {
    logError("Suggested children read failed", error, { step: "records_child_suggestions" });
    return [];
  }
  return (data ?? []).flatMap((row) =>
    row.first_name && row.last_name ? [{ ...row, first_name: row.first_name, last_name: row.last_name }] : [],
  );
}
