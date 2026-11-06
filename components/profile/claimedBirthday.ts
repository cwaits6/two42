import type { PostgrestError } from "@supabase/supabase-js";
import { birthdayColumns } from "@/components/profile/birthday";
import { createClient } from "@/lib/supabase/client";

type BirthMonth = { birth_month: number | null };

/** Follows the saved message when the household record kept the date. */
export const CLAIMED_BIRTHDAY_KEPT = "The household still lists this birthday. A church admin can remove it.";

/**
 * Whether a save takes away a birthday the profile had. A profile that was
 * already blank removes nothing: a claimed household record can hold a date
 * the household entered, which the person never saw on their own form.
 */
export function removesBirthday(profile: BirthMonth, updates: BirthMonth) {
  return profile.birth_month !== null && updates.birth_month === null;
}

/**
 * Clears the birthday on the household record a profile claimed. That record
 * keeps its own copy, which the household's members, the church admin and the
 * person's data download still read after the profile's is cleared.
 *
 * Writing no row isn't an error: most people claimed none, and the update
 * policy filters out someone who isn't that household's primary or spouse.
 * So the record is read back, and `kept` says a date is still on it. Callers
 * run this before the profile write: a failure then leaves the profile's date
 * in place, and `removesBirthday` stays true for a retry after a reload.
 */
export async function clearClaimedBirthday(
  profileId: string,
): Promise<{ error: PostgrestError | null; kept: boolean }> {
  const supabase = createClient();
  const { error } = await supabase
    .from("family_members")
    .update(birthdayColumns({ month: "", day: "", year: "" }))
    .eq("claimed_profile_id", profileId);
  if (error) return { error, kept: false };

  const { data, error: readError } = await supabase
    .from("family_members")
    .select("id")
    .eq("claimed_profile_id", profileId)
    .not("birth_month", "is", null)
    .limit(1);
  return { error: readError, kept: !readError && data.length > 0 };
}
