// The admin's org-wide queue of pending join requests, assembled from one
// pending_group_join_requests() call per group. No React, no next/* imports.

import type { Requester } from "@/lib/groups/requests";

export interface JoinQueueGroup {
  id: string;
  name: string;
}

export interface PendingJoinRequest {
  id: string;
  created_at: string;
  requester: Requester;
  /** Null when the requester hides their email; the function decides, not the page. */
  email: string | null;
  group: JoinQueueGroup;
}

export interface JoinQueueSection {
  group: JoinQueueGroup;
  requests: PendingJoinRequest[];
}

export const NO_PENDING_JOIN_REQUESTS_TEXT = "No pending join requests.";

/** One row of pending_group_join_requests(), as the function returns it. */
export interface PendingJoinRequestRow {
  id: string;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
}

/** Tags the function's row with the group it was read for; the row itself carries no group. */
export function toPendingJoinRequest(
  group: JoinQueueGroup,
  raw: PendingJoinRequestRow,
): PendingJoinRequest {
  return {
    id: raw.id,
    created_at: raw.created_at,
    requester: {
      first_name: raw.first_name,
      last_name: raw.last_name,
      preferred_name: raw.preferred_name,
    },
    email: raw.email,
    group,
  };
}

/**
 * One section per group that has a pending request, groups in the order
 * they first appear and requests in the order given. A group with nothing
 * waiting gets no section, so an empty queue is an empty array.
 */
export function groupPendingJoinRequests(rows: PendingJoinRequest[]): JoinQueueSection[] {
  const sections = new Map<string, JoinQueueSection>();
  for (const row of rows) {
    let section = sections.get(row.group.id);
    if (!section) {
      section = { group: row.group, requests: [] };
      sections.set(row.group.id, section);
    }
    section.requests.push(row);
  }
  return [...sections.values()];
}

/** The Admin overview's one-line count of requests waiting across every group. */
export function pendingJoinRequestsSummary(count: number): string {
  if (count === 0) return NO_PENDING_JOIN_REQUESTS_TEXT;
  return `${count} join request${count === 1 ? "" : "s"} waiting.`;
}
