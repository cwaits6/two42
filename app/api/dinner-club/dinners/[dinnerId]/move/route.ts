import { NextResponse } from "next/server";
import { notifyDinnersMoved } from "@/lib/dinnerClub/notify";
import { dinnerClubRefusal, instantFrom, isUuid, serverError } from "@/lib/dinnerClub/routeErrors";
import { logError } from "@/lib/log";
import { resolveRequestOrgId } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

/**
 * Moves one dinner. Row security lets its host or a leader of the group;
 * the database clears its replies in the same write. Then the table hears.
 */
export async function POST(request: Request, { params }: { params: Promise<{ dinnerId: string }> }) {
  const { dinnerId } = await params;
  if (!isUuid(dinnerId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const startsAt = instantFrom(await request.json().catch(() => null));
  if (!startsAt) return NextResponse.json({ error: "Choose a date and time." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = await resolveRequestOrgId(supabase, { label: "dinner club move dinner" });
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: before, error: readError } = await supabase
    .from("dinners")
    .select("id, starts_at")
    .eq("id", dinnerId)
    .maybeSingle();
  if (readError) {
    const refused = dinnerClubRefusal(readError);
    if (refused) return refused;
    logError("Failed to read a dinner", readError, { route: "/api/dinner-club/dinners/[dinnerId]/move" });
    return serverError();
  }
  if (!before) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // A host who does not host this dinner matches no row: zero rows is a refusal.
  const { data: moved, error } = await supabase
    .from("dinners")
    .update({ starts_at: startsAt })
    .eq("id", dinnerId)
    .select("id");
  if (error) {
    const refused = dinnerClubRefusal(error);
    if (refused) return refused;
    logError("Failed to move a dinner", error, { route: "/api/dinner-club/dinners/[dinnerId]/move" });
    return serverError();
  }
  if (!moved?.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const result = await notifyDinnersMoved(orgId, [{ dinnerId, oldStartsAt: before.starts_at }], user.id);
    return NextResponse.json(result);
  } catch (err) {
    logError("Failed to email a moved dinner", err, { route: "/api/dinner-club/dinners/[dinnerId]/move" });
    return NextResponse.json({ sent: 0, failed: 1, capped: false });
  }
}
