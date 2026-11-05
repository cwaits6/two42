import { birthdayColumns } from "@/components/profile/birthday";
import { createClient } from "@/lib/supabase/client";

type BirthMonth = { birth_month: number | null };

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
 * person's data download still read after the profile's is cleared. Returns
 * the write's error. Writing no row isn't an error: most people claimed none,
 * and the update policy filters out someone who isn't that household's primary
 * or spouse, whose copy stays.
 */
export async function clearClaimedBirthday(profileId: string) {
  const { error } = await createClient()
    .from("family_members")
    .update(birthdayColumns({ month: "", day: "", year: "" }))
    .eq("claimed_profile_id", profileId);
  return error;
}
