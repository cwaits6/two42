import { NextResponse } from "next/server";
import { readLiveDirectory } from "@/lib/integrations/records/live";
import { getOptionalUser } from "@/lib/supabase/current-user";

/**
 * GET /api/directory/live — the directory's details shown live from the
 * church's records, for the people the signed-in person may already see.
 * `{ mode: "off" }` for a church that doesn't show details live. The answer
 * passes through and is never cached: not by Next, the browser or anything
 * between.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET() {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  return NextResponse.json(await readLiveDirectory(user.id), { headers: NO_STORE });
}
