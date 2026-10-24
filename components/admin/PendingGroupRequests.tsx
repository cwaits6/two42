"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ApprovalQueue } from "@/components/admin/ApprovalQueue";
import { createClient } from "@/lib/supabase/client";
import { groupCreationErrorMessage } from "@/lib/groups/creation";
import { displayName } from "@/lib/names";
import type { PendingGroupRequest } from "@/lib/groups/requests";

export function PendingGroupRequests({
  initialRequests,
}: {
  initialRequests: PendingGroupRequest[];
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [requests, setRequests] = useState(initialRequests);
  const [busyId, setBusyId] = useState<string | null>(null);

  function remove(id: string) {
    setRequests((prev) => prev.filter((r) => r.id !== id));
    router.refresh();
  }

  async function approve(id: string) {
    const request = requests.find((r) => r.id === id);
    if (!request) return;
    setBusyId(id);
    try {
      const { error } = await supabase.rpc("group_request_approve", { _request_id: id });
      if (error) {
        toast.error(groupCreationErrorMessage(error.code));
        return;
      }
      toast.success(`Group created. ${displayName(request.requester)} leads it.`);
      remove(id);
    } finally {
      setBusyId(null);
    }
  }

  async function decline(id: string) {
    setBusyId(id);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Session expired. Please log in again.");
        return;
      }
      // A write the UPDATE policy rejects matches zero rows without an error.
      const { data, error } = await supabase
        .from("group_requests")
        .update({ status: "declined", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
        .eq("id", id)
        .select("id");
      if (error || !data?.length) {
        toast.error("Couldn't decline the request. Please try again.");
        return;
      }
      toast.success("Request declined.");
      remove(id);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <ApprovalQueue
      rows={requests.map((r) => ({
        id: r.id,
        title: r.name,
        subtitle: `Requested by ${displayName(r.requester)}`,
        meta: [r.description, new Date(r.created_at).toLocaleDateString()]
          .filter(Boolean)
          .join(" · "),
      }))}
      onApprove={approve}
      onDecline={decline}
      busyId={busyId}
      emptyText="No requests waiting."
    />
  );
}
