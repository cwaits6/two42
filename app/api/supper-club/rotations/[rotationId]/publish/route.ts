import { NextResponse } from "next/server";
import { emailOutcome } from "@/lib/supperClub/emailOutcome";
import { notifyTablesPublished } from "@/lib/supperClub/notify";
import { isUuid } from "@/lib/groups/active";
import { supperClubRefusal, serverError } from "@/lib/supperClub/routeErrors";
import { logError } from "@/lib/log";
import { resolveRequestOrgId } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

/** Publishes the rotation's saved draft, then emails each person whose tables changed. */
export async function POST(_request: Request, { params }: { params: Promise<{ rotationId: string }> }) {
  const { rotationId } = await params;
  if (!isUuid(rotationId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = await resolveRequestOrgId(supabase, { label: "Supper club publish" });
  if (!orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase.rpc("supper_tables_publish", { _rotation_id: rotationId });
  if (error) {
    const refused = supperClubRefusal(error);
    if (refused) return refused;
    logError("Failed to publish Supper club tables", error, { route: "/api/supper-club/rotations/[rotationId]/publish" });
    return serverError();
  }

  const changed = ((data ?? []) as { profile_id: string }[]).map((row) => row.profile_id);
  try {
    return NextResponse.json({ changed: changed.length, ...emailOutcome(await notifyTablesPublished(orgId, rotationId, changed)) });
  } catch (err) {
    logError("Failed to email published Supper club tables", err, { route: "/api/supper-club/rotations/[rotationId]/publish" });
    return NextResponse.json({ changed: changed.length, ...emailOutcome(null) });
  }
}
