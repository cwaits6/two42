"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ApprovalQueue } from "@/components/admin/ApprovalQueue";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
import { reviewErrorMessage } from "@/lib/groups/joining";
import { displayName } from "@/lib/names";
import { createClient } from "@/lib/supabase/client";
import { formatInZone } from "@/lib/time/zone";
import { logError } from "@/lib/log";

interface PendingRequest {
  id: string;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
}

export function JoinRequestsManager({
  groupId,
  groupName,
  emptyText,
  timeZone,
}: {
  groupId: string;
  groupName: string;
  emptyText: string;
  timeZone: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [requests, setRequests] = useState<PendingRequest[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    const { data, error } = await supabase.rpc("pending_group_join_requests", { _group_id: groupId });
    if (error) {
      logError("Failed to load pending join requests", error, { route: "/g/[groupId]/settings/requests" });
      setFailed(true);
      return;
    }
    setRequests(data ?? []);
    setFailed(false);
  }, [supabase, groupId]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  async function review(id: string, approve: boolean) {
    const request = requests?.find((r) => r.id === id);
    if (!request) return;
    setBusyId(id);
    try {
      const { error } = await supabase.rpc("review_group_join_request", {
        _request_id: id,
        _approve: approve,
      });
      if (error) {
        toast.error(reviewErrorMessage(error.code));
        // Decided elsewhere already: the row no longer belongs in the list.
        if (error.code === "GJ004") {
          setRequests((prev) => prev && prev.filter((r) => r.id !== id));
          router.refresh();
        }
        return;
      }
      toast.success(approve ? `${displayName(request)} joined ${groupName}.` : "Request declined.");
      setRequests((prev) => prev && prev.filter((r) => r.id !== id));
      // The menu's waiting count is read on the server.
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  if (failed) return <ErrorState thing="the requests" onRetry={loadRequests} />;
  if (requests === null) return <LoadingState thing="the requests" />;
  return (
    <ApprovalQueue
      rows={requests.map((r) => ({
        id: r.id,
        title: displayName(r),
        subtitle: r.email ?? undefined,
        meta: `Requested ${formatInZone(r.created_at, timeZone, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}`,
      }))}
      onApprove={(id) => review(id, true)}
      onDecline={(id) => review(id, false)}
      busyId={busyId}
      emptyText={emptyText}
    />
  );
}
