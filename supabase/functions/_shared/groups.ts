// Group enumeration and per-group settings for the cron-triggered Edge
// Functions. Content is group-scoped, so each org run fans out per group;
// every query here carries the org_id the caller resolved through
// forEachOrg() — see _shared/orgs.ts for why the filter text is the boundary.
//
// Deliberately free of any @supabase/supabase-js import so it can be unit
// tested offline against the structural types below.

export interface Group {
  id: string;
  name: string;
}

interface QueryResult<T> {
  data: T | null;
  error: { message: string } | null;
}

/** The narrow slice of the Supabase client this module needs. */
export interface GroupClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        order(column: string): PromiseLike<QueryResult<Group[]>>;
        eq(column: string, value: unknown): {
          maybeSingle(): PromiseLike<QueryResult<{ serving_link_mode: string | null }>>;
        };
      };
    };
  };
}

/**
 * The org's groups, ordered by name for a stable run order. Throws on query
 * failure: enumerating zero groups because of an error is indistinguishable
 * from "no groups" at the call site, and would silently make the org's run
 * a no-op.
 */
export async function listGroups(supabase: GroupClient, orgId: string): Promise<Group[]> {
  const { data, error } = await supabase
    .from("groups")
    .select("id, name")
    .eq("org_id", orgId)
    .order("name");
  if (error) throw new Error(`groups query failed: ${error.message}`);
  return data ?? [];
}

export type ServingLinkMode = "signed" | "login";

/**
 * The group's serving link mode, falling back to `envDefault` when the group
 * has no settings row. Throws on query failure: an unresolvable link mode
 * must not silently degrade every link to unsigned.
 */
export async function resolveGroupLinkMode(
  supabase: GroupClient,
  orgId: string,
  groupId: string,
  envDefault: string,
): Promise<ServingLinkMode> {
  const { data, error } = await supabase
    .from("group_settings")
    .select("serving_link_mode")
    .eq("org_id", orgId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (error) throw new Error(`group_settings query failed: ${error.message}`);
  return (data?.serving_link_mode ?? envDefault) === "login" ? "login" : "signed";
}
