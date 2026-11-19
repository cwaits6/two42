import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { logError } from "@/lib/log";
import { storedForm } from "@/lib/prayer/crypto";
import { parseNewRequest, type PostedPrayerRequest } from "@/lib/prayer/requests";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonBody, prayerWriter } from "./context";

/** Posts a request. The text is sealed, and an anonymous author stored only as a hash, before it reaches the database. */
export async function POST(request: Request, { params }: { params: Promise<{ groupId: string }> }) {
  const { groupId } = await params;
  const writer = await prayerWriter(groupId);
  if (writer instanceof Response) return writer;

  const input = parseNewRequest(await jsonBody(request));
  if (!input) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const id = randomUUID();
  const form = storedForm(writer.keys, {
    id,
    orgId: writer.orgId,
    text: input.body,
    author: { anonymous: input.is_anonymous, authorId: writer.userId },
  });
  const service = await createServiceClient();
  const { data, error } = await service
    .from("prayer_requests")
    .insert({ id, org_id: writer.orgId, group_id: groupId, ...form })
    .select("id, created_at");
  const row = data?.[0];
  if (error || !row) {
    logError("Failed to post a prayer request", error, { route: "/g/[groupId]/prayer/requests" });
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }
  return NextResponse.json<PostedPrayerRequest>({ id: row.id, created_at: row.created_at });
}
