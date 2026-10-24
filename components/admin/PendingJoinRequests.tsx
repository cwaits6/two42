"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ApprovalQueue } from "@/components/admin/ApprovalQueue";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import {
  NO_PENDING_JOIN_REQUESTS_TEXT,
  groupPendingJoinRequests,
  type PendingJoinRequest,
} from "@/lib/groups/joinQueue";
import { reviewErrorMessage } from "@/lib/groups/joining";
import { displayName } from "@/lib/names";

/** Every group's pending join requests, reviewed from one page by an org admin. */
export function PendingJoinRequests({
  initialRequests,
}: {
  initialRequests: PendingJoinRequest[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [requests, setRequests] = useState(initialRequests);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [declining, setDeclining] = useState<PendingJoinRequest | null>(null);

  function remove(id: string) {
    setRequests((prev) => prev.filter((r) => r.id !== id));
  }

  async function review(request: PendingJoinRequest, approve: boolean) {
    setBusyId(request.id);
    try {
      const { error } = await supabase.rpc("review_group_join_request", {
        _request_id: request.id,
        _approve: approve,
      });
      if (error) {
        toast.error(reviewErrorMessage(error.code));
        // Decided elsewhere already: the row no longer belongs in the queue.
        if (error.code === "GJ004") remove(request.id);
        return;
      }
      toast.success(
        approve
          ? `${displayName(request.requester)} joined ${request.group.name}.`
          : "Request declined.",
      );
      remove(request.id);
      // The member counts further down the page are server-rendered.
      if (approve) router.refresh();
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
    return <p className="text-lg text-muted-foreground">{NO_PENDING_JOIN_REQUESTS_TEXT}</p>;
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
                meta: `Requested ${new Date(r.created_at).toLocaleDateString()}`,
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

      <Dialog open={declining !== null} onOpenChange={(open) => !open && setDeclining(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="pr-8">{declineTitle}</DialogTitle>
            <DialogDescription>They can ask again later.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button size="lg" variant="outline" onClick={() => setDeclining(null)}>
              Cancel
            </Button>
            <Button
              size="lg"
              variant="destructive"
              onClick={() => {
                const request = declining;
                setDeclining(null);
                if (request) review(request, false);
              }}
            >
              Decline
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
