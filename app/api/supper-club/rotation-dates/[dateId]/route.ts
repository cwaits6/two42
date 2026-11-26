import { NextResponse } from "next/server";
import { emailOutcome, type NotifyResult } from "@/lib/supperClub/emailOutcome";
import { prepareDateDeletedEmails } from "@/lib/supperClub/notify";
import { isUuid } from "@/lib/groups/active";
import { supperClubRefusal, serverError } from "@/lib/supperClub/routeErrors";
import { logError } from "@/lib/log";
import { resolveRequestOrgId } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

/**
 * Deletes one of the rotation's dates and, with it, each table's supper on
 * it; the people at those suppers are told it's off. Leaders only, by row
 * security, and a date whose suppers have happened stays.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ dateId: string }> }) {
  const { dateId } = await params;
  if (!isUuid(dateId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = await resolveRequestOrgId(supabase, { label: "Supper club delete date" });
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // The recipients are read first: the delete takes the suppers and seats they come from.
  let deliver: (() => Promise<NotifyResult>) | null = null;
  try {
    deliver = await prepareDateDeletedEmails(orgId, dateId, user.id);
  } catch (err) {
    logError("Failed to read who to email about a deleted date", err, { route: "/api/supper-club/rotation-dates/[dateId]" });
  }

  const { data: deleted, error } = await supabase.from("supper_rotation_dates").delete().eq("id", dateId).select("id");
  if (error) {
    if (error.code === "SC005") {
      return NextResponse.json({ error: "A date whose suppers have happened stays." }, { status: 400 });
    }
    const refused = supperClubRefusal(error);
    if (refused) return refused;
    logError("Failed to delete a rotation date", error, { route: "/api/supper-club/rotation-dates/[dateId]" });
    return serverError();
  }
  if (!deleted?.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (!deliver) return NextResponse.json(emailOutcome(null));
  try {
    return NextResponse.json(emailOutcome(await deliver()));
  } catch (err) {
    logError("Failed to email a deleted date's suppers", err, { route: "/api/supper-club/rotation-dates/[dateId]" });
    return NextResponse.json(emailOutcome(null));
  }
}
