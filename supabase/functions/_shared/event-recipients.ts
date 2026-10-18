// Recipient resolution for event reminders: RSVP -> current group member ->
// profile with an email. Every query carries the org_id the caller resolved
// through forEachOrg() — see _shared/orgs.ts for why the filter text is the
// boundary — and the membership step carries the event's group_id, so an
// RSVP from someone who has since left the group is dropped rather than
// mailed.
//
// Deliberately free of any @supabase/supabase-js import so it can be unit
// tested offline against the structural type below.

import { chunk } from "./chunk.ts";

export interface EventRecipient {
  id: string;
  first_name: string | null;
  preferred_name: string | null;
  email: string;
}

interface QueryResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/** The narrow slice of the Supabase client this module needs. */
export interface EventRecipientClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        eq(column: string, value: unknown): {
          in(column: string, values: unknown[]): PromiseLike<QueryResult<Record<string, unknown>>>;
        };
        in(column: string, values: unknown[]): PromiseLike<QueryResult<Record<string, unknown>>>;
      };
    };
  };
}

// PostgREST `.in()` filters serialize into the query string; keep each id
// list under URL-length limits.
const IN_CHUNK_SIZE = 200;

export async function resolveEventReminderRecipients(
  supabase: EventRecipientClient,
  orgId: string,
  groupId: string,
  eventId: string,
): Promise<EventRecipient[]> {
  const { data: rsvps, error: rsvpsError } = await supabase
    .from("rsvps")
    .select("user_id")
    .eq("org_id", orgId)
    .eq("event_id", eventId)
    .in("status", ["yes", "maybe"]);
  if (rsvpsError) throw new Error(`rsvps query failed: ${rsvpsError.message}`);
  const rsvpIds = (rsvps ?? []).map((r) => r.user_id as string);
  if (rsvpIds.length === 0) return [];

  const memberIds: string[] = [];
  for (const ids of chunk(rsvpIds, IN_CHUNK_SIZE)) {
    const { data: members, error: membersError } = await supabase
      .from("group_members")
      .select("profile_id")
      .eq("org_id", orgId)
      .eq("group_id", groupId)
      .in("profile_id", ids);
    if (membersError) throw new Error(`group_members query failed: ${membersError.message}`);
    memberIds.push(...(members ?? []).map((m) => m.profile_id as string));
  }
  if (memberIds.length === 0) return [];

  // A profile can be missing for a member id; iterating the returned rows
  // skips it.
  const recipients: EventRecipient[] = [];
  for (const ids of chunk(memberIds, IN_CHUNK_SIZE)) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, first_name, preferred_name, email")
      .eq("org_id", orgId)
      .in("id", ids);
    if (profilesError) throw new Error(`profiles query failed: ${profilesError.message}`);
    for (const p of (profiles ?? []) as unknown as Array<Omit<EventRecipient, "email"> & { email: string | null }>) {
      // Pending profiles (e.g. spouses who have never logged in) can have no
      // email — skip, don't throw. Log the id, never the address.
      if (!p.email) {
        console.error(
          "[org %s] skipping reminder: profile %s has no email (event %s)",
          orgId,
          p.id,
          eventId,
        );
        continue;
      }
      recipients.push({ id: p.id, first_name: p.first_name, preferred_name: p.preferred_name, email: p.email });
    }
  }
  return recipients;
}
