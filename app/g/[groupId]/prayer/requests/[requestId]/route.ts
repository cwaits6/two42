import { NextResponse } from "next/server";
import { isUuid } from "@/lib/groups/active";
import { logError, stepOf } from "@/lib/log";
import { decryptBody, storedForm, type RequestAuthor } from "@/lib/prayer/crypto";
import { parseRequestEdit, type PrayerRequestSaved } from "@/lib/prayer/requests";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonBody, prayerWriter, readPrayerRequest, wroteRequest, type PrayerWriter, type StoredRequest } from "../context";

type Params = { params: Promise<{ groupId: string; requestId: string }> };

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });
const failed = (step: string, error: unknown) => {
  logError("Failed to write a prayer request", error, {
    route: "/g/[groupId]/prayer/requests/[requestId]",
    step: stepOf(step),
  });
  return NextResponse.json({ error: "Save failed" }, { status: 500 });
};

/**
 * Who the rewritten row names. Only the author can change whether it is
 * anonymous, so a hashed row moving to by-name is always the caller's; a leader
 * editing someone's hashed request keeps the hash as it is.
 */
function nextAuthor(
  writer: PrayerWriter,
  row: StoredRequest,
  anonymous: boolean,
  isAuthorOfRow: boolean,
): RequestAuthor | null {
  const authorId = row.author_id ?? (isAuthorOfRow ? writer.userId : null);
  if (authorId) return { anonymous, authorId };
  return anonymous && row.author_hash ? { anonymous: true, authorHash: row.author_hash } : null;
}

/** Marks a request answered, edits its text, or switches it between by-name and anonymous. */
export async function PATCH(request: Request, { params }: Params) {
  const { groupId, requestId } = await params;
  const writer = await prayerWriter(groupId);
  if (writer instanceof Response) return writer;
  if (!isUuid(requestId)) return notFound();

  const input = parseRequestEdit(await jsonBody(request));
  if (!input) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const service = await createServiceClient();
  const { data: row, error } = await readPrayerRequest(service, writer, groupId, requestId);
  if (error) return failed("edit read", error);
  if (!row) return notFound();

  const isAuthorOfRow = wroteRequest(writer, row);
  if (!isAuthorOfRow && !writer.isLeader) return notFound();
  const anonymous = input.is_anonymous ?? row.is_anonymous;
  // A leader who could flip it would unmask the author.
  if (anonymous !== row.is_anonymous && !isAuthorOfRow) {
    return NextResponse.json({ error: "Only the author can change this" }, { status: 403 });
  }

  // Opened even when the text is replaced: under a wrong body key the new text
  // would be sealed with it, and stay unreadable once the right key is back.
  let current: string;
  try {
    const stored = row.body_ciphertext
      ? decryptBody(writer.keys, writer.orgId, row.id, row.body_ciphertext)
      : (row.body ?? "");
    current = input.body ?? stored;
  } catch (err) {
    return failed("open text", err);
  }

  const author = nextAuthor(writer, row, anonymous, isAuthorOfRow);
  if (!author) return failed("author form", undefined);
  const form = storedForm(writer.keys, { id: row.id, orgId: writer.orgId, text: current, author });
  // Guarded on the version read, so a concurrent switch to anonymous is not
  // undone by a write that read the row while it still named its author.
  const { data: updated, error: updateError } = await service
    .from("prayer_requests")
    .update({
      ...form,
      is_answered: input.is_answered ?? row.is_answered,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", writer.orgId)
    .eq("group_id", groupId)
    .eq("id", row.id)
    .eq("updated_at", row.updated_at)
    .select("id");
  if (updateError) return failed("update", updateError);
  if (!updated?.length) return NextResponse.json({ error: "Changed meanwhile" }, { status: 409 });
  return NextResponse.json<PrayerRequestSaved>({ ok: true });
}

/** Deletes a request, for its author or a leader of the group. */
export async function DELETE(_request: Request, { params }: Params) {
  const { groupId, requestId } = await params;
  const writer = await prayerWriter(groupId);
  if (writer instanceof Response) return writer;
  if (!isUuid(requestId)) return notFound();

  const service = await createServiceClient();
  const { data: row, error } = await readPrayerRequest(service, writer, groupId, requestId);
  if (error) return failed("delete read", error);
  if (!row || (!writer.isLeader && !wroteRequest(writer, row))) return notFound();

  const { data: deleted, error: deleteError } = await service
    .from("prayer_requests")
    .delete()
    .eq("org_id", writer.orgId)
    .eq("group_id", groupId)
    .eq("id", row.id)
    .select("id");
  if (deleteError) return failed("delete", deleteError);
  if (!deleted?.length) return notFound();
  return NextResponse.json<PrayerRequestSaved>({ ok: true });
}
