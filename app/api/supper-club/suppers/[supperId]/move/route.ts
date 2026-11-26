import { NextResponse } from "next/server";
import { emailOutcome } from "@/lib/supperClub/emailOutcome";
import { notifySuppersMoved } from "@/lib/supperClub/notify";
import { isUuid } from "@/lib/groups/active";
import { supperClubRefusal, instantFrom, serverError } from "@/lib/supperClub/routeErrors";
import { logError } from "@/lib/log";
import { resolveRequestOrgId } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

/**
 * Moves one supper. Row security lets its host or a leader of the group;
 * the database clears its replies in the same write. Then the table hears.
 */
export async function POST(request: Request, { params }: { params: Promise<{ supperId: string }> }) {
  const { supperId } = await params;
  if (!isUuid(supperId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const startsAt = instantFrom(await request.json().catch(() => null));
  if (!startsAt) return NextResponse.json({ error: "Choose a date and time." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = await resolveRequestOrgId(supabase, { label: "Supper club move supper" });
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: before, error: readError } = await supabase
    .from("suppers")
    .select("id, starts_at")
    .eq("id", supperId)
    .maybeSingle();
  if (readError) {
    const refused = supperClubRefusal(readError);
    if (refused) return refused;
    logError("Failed to read a supper", readError, { route: "/api/supper-club/suppers/[supperId]/move" });
    return serverError();
  }
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // The same start is no move: the database keeps the replies, so nobody is asked again.
  if (Date.parse(before.starts_at) === Date.parse(startsAt)) {
    return NextResponse.json(emailOutcome({ sent: 0, failed: 0, capped: false }));
  }

  // A host who does not host this supper matches no row: zero rows is a refusal.
  const { data: moved, error } = await supabase
    .from("suppers")
    // A moved supper asks its host again, as it asks everyone's reply again.
    .update({ starts_at: startsAt, host_unavailable: false })
    .eq("id", supperId)
    .select("id");
  if (error) {
    const refused = supperClubRefusal(error);
    if (refused) return refused;
    logError("Failed to move a supper", error, { route: "/api/supper-club/suppers/[supperId]/move" });
    return serverError();
  }
  if (!moved?.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    return NextResponse.json(
      emailOutcome(await notifySuppersMoved(orgId, [{ supperId, oldStartsAt: before.starts_at }], user.id)),
    );
  } catch (err) {
    logError("Failed to email a moved supper", err, { route: "/api/supper-club/suppers/[supperId]/move" });
    return NextResponse.json(emailOutcome(null));
  }
}
