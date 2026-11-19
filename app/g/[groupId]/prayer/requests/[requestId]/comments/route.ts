import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { isUuid } from "@/lib/groups/active";
import { logError, stepOf } from "@/lib/log";
import { authorHash, encryptBody } from "@/lib/prayer/crypto";
import { parseNewComment, type PostedPrayerComment } from "@/lib/prayer/comments";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonBody, prayerWriter, readPrayerRequest } from "../../context";

type Params = { params: Promise<{ groupId: string; requestId: string }> };

const failed = (step: string, error: unknown) => {
  logError("Failed to post a prayer comment", error, {
    route: "/g/[groupId]/prayer/requests/[requestId]/comments",
    step: stepOf(step),
  });
  return NextResponse.json({ error: "Save failed" }, { status: 500 });
};

/**
 * Posts a comment on a request in the group. The text is sealed, and a writer
 * who hides their name stored only as a hash, before it reaches the database.
 */
export async function POST(request: Request, { params }: Params) {
  const { groupId, requestId } = await params;
  const writer = await prayerWriter(groupId);
  if (writer instanceof Response) return writer;
  if (!isUuid(requestId)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const input = parseNewComment(await jsonBody(request));
  if (!input) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const service = await createServiceClient();
  const { data: parent, error: readError } = await readPrayerRequest(service, writer, groupId, requestId);
  if (readError) return failed("request read", readError);
  if (!parent) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const id = randomUUID();
  const { data, error } = await service
    .from("prayer_comments")
    .insert({
      id,
      org_id: writer.orgId,
      request_id: parent.id,
      body_ciphertext: encryptBody(writer.keys, writer.orgId, id, input.body),
      only_asker: input.only_asker,
      hide_name: input.hide_name,
      writer_id: input.hide_name ? null : writer.userId,
      writer_hash: input.hide_name ? authorHash(writer.keys, writer.orgId, id, writer.userId) : null,
    })
    .select("id, created_at");
  const row = data?.[0];
  if (error || !row) return failed("insert", error);
  return NextResponse.json<PostedPrayerComment>({ id: row.id, created_at: row.created_at });
}
