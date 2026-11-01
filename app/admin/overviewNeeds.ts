export interface OverviewNeed {
  title: string;
  summary: string;
  /** Left out when there is nothing to review. */
  action?: { href: string; label: string };
}

function waiting(count: number, noun: string): string {
  return count === 1 ? `1 ${noun} waiting.` : `${count} ${noun}s waiting.`;
}

/** What is waiting on a church admin, and where each kind of request is reviewed. */
export function overviewNeeds(counts: {
  accessRequests: number;
  groupRequests: number;
  joinRequests: number;
  joinSummary: string;
}): OverviewNeed[] {
  return [
    {
      title: "Access requests",
      summary: counts.accessRequests ? waiting(counts.accessRequests, "request") : "No requests waiting.",
      action: counts.accessRequests
        ? { href: "/admin/members?tab=requests", label: "Review access requests" }
        : undefined,
    },
    {
      title: "Group requests",
      summary: counts.groupRequests ? waiting(counts.groupRequests, "request") : "No requests waiting.",
      action: counts.groupRequests ? { href: "/admin/groups", label: "Review group requests" } : undefined,
    },
    {
      title: "Join requests",
      summary: counts.joinSummary,
      action: counts.joinRequests ? { href: "/admin/groups", label: "Review join requests" } : undefined,
    },
  ];
}
