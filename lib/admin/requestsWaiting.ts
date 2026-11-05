// The counting shared by the Requests page and the server count. No React, no next/* imports,
// so the browser can load it.

/** How many of each kind are waiting; null for a kind that could not be read. */
export interface WaitingCounts {
  access: number | null;
  group: number | null;
  join: number | null;
}

/**
 * Every request waiting on a church admin, or null when any kind is unknown:
 * a total that leaves a kind out would be quietly short.
 */
export function totalWaiting({ access, group, join }: WaitingCounts): number | null {
  if (access === null || group === null || join === null) return null;
  return access + group + join;
}

/** The one sentence for how many requests are waiting. */
export function requestsWaiting(total: number): string {
  if (total === 0) return "No requests waiting.";
  return total === 1 ? "1 request waiting." : `${total} requests waiting.`;
}
