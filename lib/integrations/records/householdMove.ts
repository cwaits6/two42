// What records_confirm_household() does for each person it moves, for the
// routes that move someone with no household into one without it. Call both
// on the service client with an `orgId` from the caller's validated anchor;
// neither throws, and a failure is logged.
//
// The order is the point. The anniversary source goes before the move: a
// refresh between the move and the delete would read the new household's date
// with the old source and replace it, and nothing it re-checks has changed.
// Dropped first, a copy planned before it is refused as stale, and one planned
// after it is a first fill, which keeps an entered date. Without a household
// the source copies nothing, so dropping it for a move that then fails is
// harmless. The full copy is asked for only after both succeed: asked for with
// the source still there, that copy would replace the date too.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { logError } from "@/lib/log";

type Service = SupabaseClient<Database>;

async function failure(write: () => PromiseLike<{ error: unknown }>): Promise<unknown> {
  try {
    return (await write()).error;
  } catch (err) {
    return err ?? new Error("write threw");
  }
}

/**
 * Before moving `profileId`, who has no household, into one: drops their
 * anniversary source, an old household's. True when it is gone, or there was none.
 */
export async function dropAnniversarySourceBeforeMove(
  service: Service,
  orgId: string,
  profileId: string,
  route: string,
): Promise<boolean> {
  const error = await failure(() =>
    service
      .from("records_field_values")
      .delete()
      .eq("org_id", orgId)
      .eq("profile_id", profileId)
      .eq("field", "anniversary"),
  );
  if (!error) return true;
  logError("church records: dropping a moving person's anniversary source failed", error, {
    route,
    step: "records_field_values",
    ids: { org: orgId, profile: profileId },
  });
  return false;
}

/**
 * Once the move is written, and only if dropAnniversarySourceBeforeMove()
 * returned true: the next refresh copies `profileId` in full, which brings in
 * the new household's anniversary.
 */
export async function copyInFullAfterMove(
  service: Service,
  orgId: string,
  profileId: string,
  route: string,
): Promise<void> {
  const error = await failure(() =>
    service
      .from("records_person_state")
      .update({ copied_at: null })
      .eq("org_id", orgId)
      .eq("profile_id", profileId)
      .not("copied_at", "is", null),
  );
  if (!error) return;
  logError("church records: marking a moved person to be copied in full failed", error, {
    route,
    step: "records_person_state",
    ids: { org: orgId, profile: profileId },
  });
}
