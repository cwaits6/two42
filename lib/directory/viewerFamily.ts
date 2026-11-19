import { createClient } from "@/lib/supabase/server";
import { logError } from "@/lib/log";

/**
 * The signed-in person's own household id, read from their own profile.
 * The directory views list only people who are not hidden, so a hidden
 * viewer cannot be matched to their household through its member list.
 * Resolves to null when the person has no household or the read fails.
 */
export async function getViewerFamilyId(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("family_id")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    logError("Failed to load the viewer's household", error);
    return null;
  }
  return data?.family_id ?? null;
}
