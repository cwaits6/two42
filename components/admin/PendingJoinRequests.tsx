"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox } from "lucide-react";
import { toast } from "sonner";
import { ApprovalQueue } from "@/components/admin/ApprovalQueue";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/states/EmptyState";
import { createClient } from "@/lib/supabase/client";
import {
  NO_PENDING_JOIN_REQUESTS_TEXT,
  groupPendingJoinRequests,
  requestedOn,
  type PendingJoinRequest,
} from "@/lib/groups/joinQueue";
import { reviewErrorMessage } from "@/lib/groups/joining";
import { displayName } from "@/lib/names";

/** Every group's pending join requests, reviewed from one page by an org admin. */
export function PendingJoinRequests({
  initialRequests,
  timeZone,
}: {
  initialRequests: PendingJoinRequest[];
  timeZone: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [requests, setRequests] = useState(initialRequests);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [declining, setDeclining] = useState<PendingJoinRequest | null>(null);

  function remove(id: string) {
    setRequests((prev) => prev.filter((r) => r.id !== id));
  }

  /** True once the request is decided, here or elsewhere, so nothing is left to retry. */
  async function review(request: PendingJoinRequest, approve: boolean): Promise<boolean> {
    setBusyId(request.id);
    try {
      const { error } = await supabase.rpc("review_group_join_request", {
        _request_id: request.id,
        _approve: approve,
      });
      if (error) {
        toast.error(reviewErrorMessage(error.code));
        // Decided elsewhere already: the row no longer belongs in the queue.
        if (error.code !== "GJ004") return false;
        remove(request.id);
        return true;
      }
      toast.success(
        approve
          ? `${displayName(request.requester)} joined ${request.group.name}.`
          : "Request declined.",
      );
      remove(request.id);
      // The member counts further down the page are server-rendered.
      if (approve) router.refresh();
      return true;
    } finally {
      setBusyId(null);
    }
  }

  function byId(id: string) {
    return requests.find((r) => r.id === id);
  }

  const sections = groupPendingJoinRequests(requests);
  const declineTitle = declining
    ? `Decline ${displayName(declining.requester)}'s request to join ${declining.group.name}?`
    : "";
  if (sections.length === 0) {
    return <EmptyState icon={Inbox} message={NO_PENDING_JOIN_REQUESTS_TEXT} />;
  }

  return (
    <>
      <div className="space-y-8">
        {sections.map(({ group, requests: rows }) => (
          <section key={group.id} aria-labelledby={`join-queue-${group.id}`}>
            <h3
              id={`join-queue-${group.id}`}
              className="mb-3 text-xl font-semibold text-foreground"
            >
              {group.name}
            </h3>
            <ApprovalQueue
              rows={rows.map((r) => ({
                id: r.id,
                title: displayName(r.requester),
                subtitle: r.email ?? undefined,
                meta: `Requested ${requestedOn(r.created_at, timeZone)}`,
              }))}
              onApprove={(id) => {
                const request = byId(id);
                if (request) review(request, true);
              }}
              onDecline={(id) => setDeclining(byId(id) ?? null)}
              busyId={busyId}
              emptyText={NO_PENDING_JOIN_REQUESTS_TEXT}
            />
          </section>
        ))}
      </div>

      <ConfirmDialog
        open={declining !== null}
        onOpenChange={(open) => !open && setDeclining(null)}
        title={declineTitle}
        description="They can ask again later."
        confirmLabel="Decline request"
        pendingLabel="Declining…"
        onConfirm={async () => {
          if (declining && (await review(declining, false))) setDeclining(null);
        }}
      />
    </>
  );
}
