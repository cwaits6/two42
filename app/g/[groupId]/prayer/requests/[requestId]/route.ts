import { NextResponse } from "next/server";
import { isUuid } from "@/lib/groups/active";
import { logError, stepOf } from "@/lib/log";
import { decryptBody, isAuthor, storedForm, type RequestAuthor } from "@/lib/prayer/crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { jsonBody, prayerWriter, requestText, type PrayerWriter } from "../context";

type Params = { params: Promise<{ groupId: string; requestId: string }> };
type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

interface StoredRequest {
  id: string;
  body: string | null;
  body_ciphertext: string | null;
  is_anonymous: boolean;
  is_answered: boolean;
  author_id: string | null;
  author_hash: string | null;
  updated_at: string;
}

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });
const failed = (step: string, error: unknown) => {
  logError("Failed to write a prayer request", error, {
    route: "/g/[groupId]/prayer/requests/[requestId]",
    step: stepOf(step),
  });
  return NextResponse.json({ error: "Save failed" }, { status: 500 });
};

async function readRequest(service: ServiceClient, writer: PrayerWriter, groupId: string, requestId: string) {
  return service
    .from("prayer_requests")
    .select("id, body, body_ciphertext, is_anonymous, is_answered, author_id, author_hash, updated_at")
    .eq("org_id", writer.orgId)
    .eq("group_id", groupId)
    .eq("id", requestId)
    .maybeSingle<StoredRequest>();
}

function wroteIt(writer: PrayerWriter, row: StoredRequest): boolean {
  if (row.author_id) return row.author_id === writer.userId;
  return row.author_hash !== null && isAuthor(writer.keys, writer.orgId, row.id, writer.userId, row.author_hash);
}

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

  const input = await jsonBody(request);
  const text = input?.body === undefined ? undefined : requestText(input.body);
  if (
    !input ||
    text === null ||
    (input.is_answered !== undefined && typeof input.is_answered !== "boolean") ||
    (input.is_anonymous !== undefined && typeof input.is_anonymous !== "boolean") ||
    (text === undefined && input.is_answered === undefined && input.is_anonymous === undefined)
  ) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const service = await createServiceClient();
  const { data: row, error } = await readRequest(service, writer, groupId, requestId);
  if (error) return failed("edit read", error);
  if (!row) return notFound();

  const isAuthorOfRow = wroteIt(writer, row);
  if (!isAuthorOfRow && !writer.isLeader) return notFound();
  const anonymous = typeof input.is_anonymous === "boolean" ? input.is_anonymous : row.is_anonymous;
  // A leader who could flip it would unmask the author.
  if (anonymous !== row.is_anonymous && !isAuthorOfRow) {
    return NextResponse.json({ error: "Only the author can change this" }, { status: 403 });
  }

  let current: string;
  try {
    current = text ?? (row.body_ciphertext ? decryptBody(writer.keys, writer.orgId, row.id, row.body_ciphertext) : (row.body ?? ""));
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
      is_answered: typeof input.is_answered === "boolean" ? input.is_answered : row.is_answered,
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", writer.orgId)
    .eq("group_id", groupId)
    .eq("id", row.id)
    .eq("updated_at", row.updated_at)
    .select("id");
  if (updateError) return failed("update", updateError);
  if (!updated?.length) return NextResponse.json({ error: "Changed meanwhile" }, { status: 409 });
  return NextResponse.json({ ok: true });
}

/** Deletes a request, for its author or a leader of the group. */
export async function DELETE(_request: Request, { params }: Params) {
  const { groupId, requestId } = await params;
  const writer = await prayerWriter(groupId);
  if (writer instanceof Response) return writer;
  if (!isUuid(requestId)) return notFound();

  const service = await createServiceClient();
  const { data: row, error } = await readRequest(service, writer, groupId, requestId);
  if (error) return failed("delete read", error);
  if (!row || (!writer.isLeader && !wroteIt(writer, row))) return notFound();

  const { data: deleted, error: deleteError } = await service
    .from("prayer_requests")
    .delete()
    .eq("org_id", writer.orgId)
    .eq("group_id", groupId)
    .eq("id", row.id)
    .select("id");
  if (deleteError) return failed("delete", deleteError);
  if (!deleted?.length) return notFound();
  return NextResponse.json({ ok: true });
}
