import { NextResponse } from "next/server";
import { emailOutcome } from "@/lib/dinnerClub/emailOutcome";
import { notifyTablesPublished } from "@/lib/dinnerClub/notify";
import { dinnerClubRefusal, isUuid, serverError } from "@/lib/dinnerClub/routeErrors";
import { logError } from "@/lib/log";
import { resolveRequestOrgId } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

/** Publishes the season's saved draft, then emails each person whose tables changed. */
export async function POST(_request: Request, { params }: { params: Promise<{ seasonId: string }> }) {
  const { seasonId } = await params;
  if (!isUuid(seasonId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = await resolveRequestOrgId(supabase, { label: "dinner club publish" });
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase.rpc("dinner_tables_publish", { _season_id: seasonId });
  if (error) {
    const refused = dinnerClubRefusal(error);
    if (refused) return refused;
    logError("Failed to publish dinner club tables", error, { route: "/api/dinner-club/seasons/[seasonId]/publish" });
    return serverError();
  }

  const changed = ((data ?? []) as { profile_id: string }[]).map((row) => row.profile_id);
  try {
    return NextResponse.json({ changed: changed.length, ...emailOutcome(await notifyTablesPublished(orgId, seasonId, changed)) });
  } catch (err) {
    logError("Failed to email published dinner club tables", err, { route: "/api/dinner-club/seasons/[seasonId]/publish" });
    return NextResponse.json({ changed: changed.length, ...emailOutcome(null) });
  }
}
