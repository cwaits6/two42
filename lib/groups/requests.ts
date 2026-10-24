// The pending-request read the Admin overview and Admin › Groups share.
// No React, no next/* imports.

export interface Requester {
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
}

export interface PendingGroupRequest {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  requester: Requester | null;
}

export const PENDING_GROUP_REQUEST_SELECT =
  "id, name, description, created_at, requester:profiles!group_requests_requested_by_fkey(first_name, last_name, preferred_name)";

/**
 * PostgREST returns a many-to-one embed as one object, but the generated
 * types cannot tell that through a composite FK and type it as an array;
 * accept both shapes rather than cast.
 */
export function toPendingGroupRequest(row: {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  requester: Requester | Requester[] | null;
}): PendingGroupRequest {
  const requester = Array.isArray(row.requester) ? (row.requester[0] ?? null) : row.requester;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    created_at: row.created_at,
    requester,
  };
}
