import { NextResponse } from "next/server";
import { notifyDinnersMoved } from "@/lib/dinnerClub/notify";
import { dinnerClubFailure, instantFrom, isUuid } from "@/lib/dinnerClub/routeErrors";
import { logError } from "@/lib/log";
import { resolveRequestOrgId } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

const ROUTE = "/api/dinner-club/season-dates/[dateId]/move";

/**
 * Moves one of the season's dates, which moves each table's dinner on it
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
  const orgId = await resolveRequestOrgId(supabase, { label: "dinner club move date" });
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const readDinners = () => supabase.from("dinners").select("id, starts_at").eq("season_date_id", dateId);
  const { data: before, error: beforeError } = await readDinners();
  if (beforeError) return dinnerClubFailure(beforeError, ROUTE, "Failed to read a date's dinners");

  const { data: updated, error } = await supabase
    .from("dinner_season_dates")
    .update({ starts_at: startsAt })
    .eq("id", dateId)
    .select("id");
  if (error) return dinnerClubFailure(error, ROUTE, "Failed to move a season date");
  if (!updated?.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: after, error: afterError } = await readDinners();
  if (afterError) {
    logError("Failed to read a moved date's dinners", afterError, { route: ROUTE });
    return NextResponse.json({ sent: 0, failed: 0, capped: false });
  }
  const was = new Map((before ?? []).map((d) => [d.id, d.starts_at]));
  const moves = (after ?? [])
    .filter((d) => was.has(d.id) && was.get(d.id) !== d.starts_at)
    .map((d) => ({ dinnerId: d.id, oldStartsAt: was.get(d.id) as string }));
  try {
    return NextResponse.json(await notifyDinnersMoved(orgId, moves, user.id));
  } catch (err) {
    logError("Failed to email moved dinners", err, { route: ROUTE });
    return NextResponse.json({ sent: 0, failed: moves.length, capped: false });
  }
}
