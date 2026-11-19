import { NextResponse } from "next/server";
import { isUuid } from "@/lib/groups/active";
import { logError, stepOf } from "@/lib/log";
import { wroteComment } from "@/lib/prayer/commentThread";
import type { PrayerRequestSaved } from "@/lib/prayer/requests";
import { createServiceClient } from "@/lib/supabase/server";
import { prayerWriter, readPrayerRequest, wroteRequest } from "../../../context";

type Params = { params: Promise<{ groupId: string; requestId: string; commentId: string }> };

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });
const failed = (step: string, error: unknown) => {
  logError("Failed to delete a prayer comment", error, {
    route: "/g/[groupId]/prayer/requests/[requestId]/comments/[commentId]",
    step: stepOf(step),
  });
  return NextResponse.json({ error: "Save failed" }, { status: 500 });
};

/**
 * Deletes a comment, for its writer, the person who posted the request, or a
 * leader of the group. Anyone else gets the same 404 as a missing comment.
 */
export async function DELETE(_request: Request, { params }: Params) {
  const { groupId, requestId, commentId } = await params;
  const writer = await prayerWriter(groupId);
  if (writer instanceof Response) return writer;
  if (!isUuid(requestId) || !isUuid(commentId)) return notFound();

  const service = await createServiceClient();
  const { data: parent, error: requestError } = await readPrayerRequest(service, writer, groupId, requestId);
  if (requestError) return failed("request read", requestError);
  if (!parent) return notFound();

  const { data: comment, error: commentError } = await service
    .from("prayer_comments")
    .select("id, writer_id, writer_hash")
    .eq("org_id", writer.orgId)
    .eq("request_id", parent.id)
    .eq("id", commentId)
    .maybeSingle();
  if (commentError) return failed("comment read", commentError);
  if (!comment) return notFound();
  const allowed =
    writer.isLeader || wroteRequest(writer, parent) || wroteComment(writer.keys, writer.orgId, writer.userId, comment);
  if (!allowed) return notFound();

  const { data: deleted, error } = await service
    .from("prayer_comments")
    .delete()
    .eq("org_id", writer.orgId)
    .eq("request_id", parent.id)
    .eq("id", comment.id)
    .select("id");
  if (error) return failed("delete", error);
  if (!deleted?.length) return notFound();
  return NextResponse.json<PrayerRequestSaved>({ ok: true });
}
