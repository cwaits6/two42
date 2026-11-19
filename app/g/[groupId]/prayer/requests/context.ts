import { NextResponse } from "next/server";
import { isUuid } from "@/lib/groups/active";
import { getGroupMemberships } from "@/lib/groups/server";
import { logError } from "@/lib/log";
import { isAuthor, type PrayerKeys } from "@/lib/prayer/crypto";
import { loadPrayerKeys } from "@/lib/prayer/keys";
import { getOptionalUser } from "@/lib/supabase/current-user";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export interface PrayerWriter {
  userId: string;
  /** From the caller's own RLS-scoped profile; every service write filters on it. */
  orgId: string;
  isLeader: boolean;
  keys: PrayerKeys;
}

/**
 * Who is writing, or the response that refuses them. A non-member gets the
 * same 404 as a group that does not exist.
 */
export async function prayerWriter(groupId: string): Promise<PrayerWriter | Response> {
  const user = await getOptionalUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const memberships = isUuid(groupId) ? await getGroupMemberships() : [];
  const group = memberships.find((m) => m.id === groupId);
  if (!group) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const supabase = await createClient();
  const { data: profile, error } = await supabase.from("profiles").select("org_id").eq("id", user.id).maybeSingle();
  if (error || !profile) {
    logError("Failed to read the writer's profile for a prayer request", error);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }

  const keys = loadPrayerKeys();
  if (!keys) {
    logError("Prayer keys are not configured");
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }

  return { userId: user.id, orgId: profile.org_id, isLeader: group.role === "leader", keys };
}

export async function jsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>;

/** The request, read on the writer's church and the group in the URL. */
export async function readPrayerRequest(service: ServiceClient, writer: PrayerWriter, groupId: string, requestId: string) {
  return service
    .from("prayer_requests")
    // "*" so a delete still works before the migration adds the sealed columns.
    .select("*")
    .eq("org_id", writer.orgId)
    .eq("group_id", groupId)
    .eq("id", requestId)
    .maybeSingle();
}

export type StoredRequest = NonNullable<Awaited<ReturnType<typeof readPrayerRequest>>["data"]>;

/** Whether the writer posted the request, by name or, on an anonymous one, by its author hash. */
export function wroteRequest(writer: PrayerWriter, row: Pick<StoredRequest, "id" | "author_id" | "author_hash">): boolean {
  if (row.author_id) return row.author_id === writer.userId;
  return row.author_hash !== null && isAuthor(writer.keys, writer.orgId, row.id, writer.userId, row.author_hash);
}
