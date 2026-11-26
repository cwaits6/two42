import { NextResponse } from "next/server";
import { emailOutcome } from "@/lib/supperClub/emailOutcome";
import { notifySuppersMoved } from "@/lib/supperClub/notify";
import { isUuid } from "@/lib/groups/active";
import { supperClubRefusal, instantFrom, serverError } from "@/lib/supperClub/routeErrors";
import { logError } from "@/lib/log";
import { resolveRequestOrgId } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

/**
 * Moves one of the rotation's dates, which moves each table's supper on it
 * that its host has not moved separately. Leaders only, by row security.
 */
export async function POST(request: Request, { params }: { params: Promise<{ dateId: string }> }) {
  const { dateId } = await params;
  if (!isUuid(dateId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const startsAt = instantFrom(await request.json().catch(() => null));
  if (!startsAt) return NextResponse.json({ error: "Choose a date and time." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = await resolveRequestOrgId(supabase, { label: "Supper club move date" });
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const readSuppers = () => supabase.from("suppers").select("id, starts_at").eq("rotation_date_id", dateId);
  const { data: before, error: beforeError } = await readSuppers();
  if (beforeError) {
    const refused = supperClubRefusal(beforeError);
    if (refused) return refused;
    logError("Failed to read a date's suppers", beforeError, { route: "/api/supper-club/rotation-dates/[dateId]/move" });
    return serverError();
  }

  const { data: updated, error } = await supabase
    .from("supper_rotation_dates")
    .update({ starts_at: startsAt })
    .eq("id", dateId)
    .select("id");
  if (error) {
    const refused = supperClubRefusal(error);
    if (refused) return refused;
    logError("Failed to move a rotation date", error, { route: "/api/supper-club/rotation-dates/[dateId]/move" });
    return serverError();
  }
  if (!updated?.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: after, error: afterError } = await readSuppers();
  if (afterError) {
    logError("Failed to read a moved date's suppers", afterError, { route: "/api/supper-club/rotation-dates/[dateId]/move" });
    return NextResponse.json(emailOutcome(null));
  }
  const was = new Map((before ?? []).map((d) => [d.id, d.starts_at]));
  const moves = (after ?? [])
    .filter((d) => was.has(d.id) && was.get(d.id) !== d.starts_at)
    .map((d) => ({ supperId: d.id, oldStartsAt: was.get(d.id) as string }));
  try {
    return NextResponse.json(emailOutcome(await notifySuppersMoved(orgId, moves, user.id)));
  } catch (err) {
    logError("Failed to email moved suppers", err, { route: "/api/supper-club/rotation-dates/[dateId]/move" });
    return NextResponse.json(emailOutcome(null));
  }
}
