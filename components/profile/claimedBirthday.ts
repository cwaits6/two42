import { createClient } from "@/lib/supabase/client";

/**
 * Clears the birthday on the household record a profile claimed. That record
 * keeps its own copy, which the household's members, the church admin and the
 * person's data download still read after the profile's is cleared. Returns
 * the write's error; writing no row is usual, since most people claimed none.
 */
export async function clearClaimedBirthday(profileId: string) {
  const { error } = await createClient()
    .from("family_members")
    .update({ birth_month: null, birth_day: null, birth_year: null })
    .eq("claimed_profile_id", profileId);
  return error;
}
