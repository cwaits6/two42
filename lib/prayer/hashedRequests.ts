import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { isAuthor, type PrayerKeys } from "@/lib/prayer/crypto";
import { fetchAll } from "@/lib/supabase/fetchAll";

/**
 * The person's anonymous requests stored as a hash, which no foreign key ties
 * to them: every hashed request in the church is read, since only the author
 * key tells whose is whose, and under a wrong key none of them match. `orgId`
 * must come from an anchor the caller already validated.
 */
export async function hashedRequestsOf<Row extends { id: string; author_hash: string | null }>(
  client: SupabaseClient,
  orgId: string,
  personId: string,
  keys: PrayerKeys,
  // All columns: the app deploys before the migration that adds the sealed
  // columns, and naming one that is missing fails the read.
  select: "*" | "*, groups(name)",
) {
  const { data, error } = await fetchAll<Row, PostgrestError>((from, to) =>
    client
      .from("prayer_requests")
      .select(select)
      .eq("org_id", orgId)
      .eq("is_anonymous", true)
      .is("author_id", null)
      .order("id")
      .range(from, to)
      .returns<Row[]>(),
  );
  if (error) return { data: null, error };
  return {
    data: (data ?? []).filter(
      (row) => row.author_hash !== null && isAuthor(keys, orgId, row.id, personId, row.author_hash),
    ),
    error: null,
  };
}
