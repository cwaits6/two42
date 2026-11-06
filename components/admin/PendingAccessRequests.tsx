"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ApprovalQueue } from "@/components/admin/ApprovalQueue";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { requestsWaiting } from "@/lib/admin/requestsWaiting";
import { failureMessage, NETWORK_ERROR } from "@/lib/errorCopy";
import { requestedOn } from "@/lib/groups/joinQueue";
import { createClient } from "@/lib/supabase/client";
import type { AccessRequest } from "@/lib/types";
import { logError } from "@/lib/log";

const ALREADY_REVIEWED = "This request was already reviewed.";

export type PendingAccessRequest = Pick<AccessRequest, "id" | "name" | "email" | "message" | "created_at">;

/**
 * People asking to join the church. The list belongs to the caller, which is
 * told when a request is decided and leaves it.
 */
export function PendingAccessRequests({
  requests,
  onRemove,
  timeZone,
}: {
  requests: PendingAccessRequest[];
  onRemove: (id: string) => void;
  timeZone: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [declining, setDeclining] = useState<PendingAccessRequest | null>(null);

  async function approve(request: PendingAccessRequest) {
    setBusyId(request.id);
    try {
      const res = await fetch("/api/admin/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: request.email, name: request.name }),
      });
      if (!res.ok) {
        toast.error(failureMessage("approve the request", res.status, { 404: ALREADY_REVIEWED }));
        if (res.status === 404) onRemove(request.id);
        return;
      }
      toast.success("Request approved.");
      onRemove(request.id);
    } catch {
      toast.error(NETWORK_ERROR);
    } finally {
      setBusyId(null);
    }
  }

  async function decline(request: PendingAccessRequest) {
    setBusyId(request.id);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error(failureMessage("decline the request", 401));
        return;
      }
      // A write RLS rejects matches zero rows without an error, and so does a
      // decline that lost the race to another admin's review.
      const { data, error } = await supabase
        .from("access_requests")
        .update({
          status: "denied",
          reviewed_by: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", request.id)
        .eq("status", "pending")
        .select("id");
      if (error) {
        logError("Failed to decline an access request", error);
        toast.error(failureMessage("decline the request"));
        return;
      }
      toast[data.length ? "success" : "error"](data.length ? "Request declined." : ALREADY_REVIEWED);
      setDeclining(null);
      onRemove(request.id);
    } finally {
      setBusyId(null);
    }
  }

  const byId = (id: string) => requests.find((r) => r.id === id);

  return (
    <>
      <ApprovalQueue
        rows={requests.map((req) => ({
          id: req.id,
          title: req.name,
          subtitle: req.email,
          quote: req.message ?? undefined,
          meta: `Requested ${requestedOn(req.created_at, timeZone)}`,
        }))}
        onApprove={(id) => {
          const request = byId(id);
          if (request) approve(request);
        }}
        onDecline={(id) => setDeclining(byId(id) ?? null)}
        busyId={busyId}
        emptyText={requestsWaiting(0)}
      />
      <ConfirmDialog
        open={declining !== null}
        onOpenChange={(open) => !open && setDeclining(null)}
        title={`Decline ${declining?.name ?? ""}'s request?`}
        description="They won't get an invite. They can ask again later."
        confirmLabel="Decline request"
        pendingLabel="Declining…"
        onConfirm={async () => {
          if (declining) await decline(declining);
        }}
      />
    </>
  );
}
