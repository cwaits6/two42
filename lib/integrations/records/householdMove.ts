// What records_confirm_household() does for each person it moves, for the
// routes that move someone into a household without it.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { logError } from "@/lib/log";

/**
 * After `profileId` moved into a different household: drop their anniversary
 * source, which was their old household's, then mark them to be copied in
 * full at the next refresh. That copy is a first fill, so it brings in the new
 * household's anniversary and keeps a date already entered there.
 *
 * Call it only once the move is written, on the service client, with an
 * `orgId` from the caller's validated anchor. It never throws: the move
 * stands whatever happens here, and a failure is logged.
 *
 * The source goes first because the mark without it is the one harmful half:
 * the full copy would read the new household's date as the church's and
 * replace it. The source gone without the mark only waits for the person's
 * next change in the records.
 */
export async function restartCopyAfterHouseholdMove(
  service: SupabaseClient<Database>,
  orgId: string,
  profileId: string,
  route: string,
): Promise<void> {
  const context = { route, ids: { org: orgId, profile: profileId } };
  const failed = async (write: () => PromiseLike<{ error: unknown }>) => {
    try {
      return (await write()).error;
    } catch (err) {
      return err ?? new Error("write threw");
    }
  };

  const source = await failed(() =>
    service
      .from("records_field_values")
      .delete()
      .eq("org_id", orgId)
      .eq("profile_id", profileId)
      .eq("field", "anniversary"),
  );
  if (source) {
    logError("church records: dropping a moved person's anniversary source failed", source, {
      ...context,
      step: "records_field_values",
    });
    return;
  }

  const state = await failed(() =>
    service
      .from("records_person_state")
      .update({ copied_at: null })
      .eq("org_id", orgId)
      .eq("profile_id", profileId)
      .not("copied_at", "is", null),
  );
  if (state) {
    logError("church records: marking a moved person to be copied in full failed", state, {
      ...context,
      step: "records_person_state",
    });
  }
}
