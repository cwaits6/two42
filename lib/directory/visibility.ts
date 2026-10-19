import { createClient } from "@/lib/supabase/server";

export type DirectoryVisibility = "shared_groups" | "org";

/**
 * The caller's org's directory_visibility, read through the cookie-bound
 * request client, which returns only the caller's own organizations row.
 * Resolves to null when the read fails or returns no row; callers treat
 * that as shared_groups (no "Everyone" option) and RLS enforces the truth
 * regardless of what the UI offers.
 */
export async function getDirectoryVisibility(): Promise<DirectoryVisibility | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("directory_visibility")
    .maybeSingle();
  if (error) {
    console.error("Failed to load directory visibility:", error);
    return null;
  }
  if (!data) {
    console.warn("No organization row visible for this request; directory visibility unknown");
    return null;
  }
  return data.directory_visibility === "org" ? "org" : "shared_groups";
}
