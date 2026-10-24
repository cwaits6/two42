"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ApprovalQueue } from "@/components/admin/ApprovalQueue";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@/lib/supabase/client";
import { groupPath } from "@/lib/groups/active";
import {
  JOIN_POLICY_OPTIONS,
  PRIVATE_POLICY_HELPER,
  parseJoinPolicy,
  pendingRequestsEmptyText,
  privacyHelperText,
  reviewErrorMessage,
  type JoinPolicy,
} from "@/lib/groups/joining";
import { displayName } from "@/lib/names";

interface PendingRequest {
  id: string;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
}

interface PrivacyAndJoiningManagerProps {
  groupId: string;
  groupName: string;
  initialPrivate: boolean;
  initialPolicy: JoinPolicy;
  orgDiscoveryOn: boolean;
}

export function PrivacyAndJoiningManager({
  groupId,
  groupName,
  initialPrivate,
  initialPolicy,
  orgDiscoveryOn,
}: PrivacyAndJoiningManagerProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [isPrivate, setIsPrivate] = useState(initialPrivate);
  const [savingPrivate, setSavingPrivate] = useState(false);
  const latestPrivate = useRef(0);
  const [savedPolicy, setSavedPolicy] = useState(initialPolicy);
  const [policy, setPolicy] = useState(initialPolicy);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [requests, setRequests] = useState<PendingRequest[]>([]);
  const [requestsFailed, setRequestsFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadRequests = useCallback(async () => {
    const { data, error } = await supabase.rpc("pending_group_join_requests", { _group_id: groupId });
    if (error) {
      console.error("Failed to load pending join requests:", error);
      setRequestsFailed(true);
      return;
    }
    setRequests(data ?? []);
    setRequestsFailed(false);
  }, [supabase, groupId]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  async function togglePrivate(next: boolean) {
    const previous = isPrivate;
    const request = ++latestPrivate.current;
    setIsPrivate(next);
    setSavingPrivate(true);
    // The "Leaders and admins can update groups" policy is the authority on
    // who may save; a non-leader's write matches zero rows.
    const { data, error } = await supabase
      .from("groups")
      .update({ is_private: next })
      .eq("id", groupId)
      .select("id");
    if (request !== latestPrivate.current) return;
    setSavingPrivate(false);
    if (error || !data?.length) {
      setIsPrivate(previous);
      toast.error("Couldn't save the setting.");
      return;
    }
    toast.success(next ? "Group is now private." : "Group can be found again.");
    router.refresh();
  }

  async function savePolicy(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (policy === savedPolicy) return;
    setSavingPolicy(true);
    const { data, error } = await supabase
      .from("groups")
      .update({ join_policy: policy })
      .eq("id", groupId)
      .select("id");
    setSavingPolicy(false);
    if (error || !data?.length) {
      toast.error("Couldn't save the join policy.");
      return;
    }
    setSavedPolicy(policy);
    toast.success("Join policy saved.");
    router.refresh();
  }

  async function review(id: string, approve: boolean) {
    const request = requests.find((r) => r.id === id);
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
        if (error.code === "GJ004") setRequests((prev) => prev.filter((r) => r.id !== id));
        return;
      }
      toast.success(
        approve ? `${displayName(request)} joined ${groupName}.` : "Request declined.",
      );
      setRequests((prev) => prev.filter((r) => r.id !== id));
      if (approve) router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  const policyOption = JOIN_POLICY_OPTIONS.find((o) => o.value === policy);

  return (
    <PageContainer>
      <PageHeader
        title="Privacy and joining"
        subtitle={groupName}
        backHref={groupPath(groupId, "/settings")}
        backLabel="Back to Group settings"
      />

      <div className="space-y-6">
        <section className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Label htmlFor="group-private" className="text-xl font-bold text-foreground">
                Private group
              </Label>
              <p className="mt-2 text-base text-muted-foreground">
                {privacyHelperText(orgDiscoveryOn)}
              </p>
            </div>
            <Switch
              id="group-private"
              className="mt-1.5 shrink-0"
              checked={isPrivate}
              disabled={savingPrivate}
              onCheckedChange={togglePrivate}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-6">
          <form onSubmit={savePolicy} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="join-policy" className="text-xl font-bold text-foreground">
                Join policy
              </Label>
              <Select
                items={JOIN_POLICY_OPTIONS}
                value={policy}
                onValueChange={(v) => setPolicy(parseJoinPolicy(v))}
                disabled={isPrivate || savingPolicy}
              >
                <SelectTrigger id="join-policy" className="h-12 w-full text-base sm:max-w-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {JOIN_POLICY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-base text-muted-foreground">
                {isPrivate ? PRIVATE_POLICY_HELPER : policyOption?.description}
              </p>
            </div>
            {!isPrivate && (
              <Button
                type="submit"
                size="lg"
                disabled={savingPolicy || policy === savedPolicy}
                className="bg-brand-primary text-white hover:bg-brand-primary/90"
              >
                {savingPolicy ? "Saving…" : "Save join policy"}
              </Button>
            )}
          </form>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-bold text-foreground">Pending join requests</h2>
          {requestsFailed ? (
            <p role="alert" className="text-lg text-muted-foreground">
              Couldn&apos;t load the requests. Reload the page to try again.
            </p>
          ) : (
            <ApprovalQueue
              rows={requests.map((r) => ({
                id: r.id,
                title: displayName(r),
                subtitle: r.email ?? undefined,
                meta: `Requested ${new Date(r.created_at).toLocaleDateString()}`,
              }))}
              onApprove={(id) => review(id, true)}
              onDecline={(id) => review(id, false)}
              busyId={busyId}
              emptyText={pendingRequestsEmptyText(savedPolicy)}
            />
          )}
        </section>
      </div>
    </PageContainer>
  );
}
