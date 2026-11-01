"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ApprovalQueue } from "@/components/admin/ApprovalQueue";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorState } from "@/components/states/ErrorState";
import { LoadingState } from "@/components/states/LoadingState";
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
  privacyHelper,
  reviewErrorMessage,
  type HelperSentence,
  type JoinPolicy,
} from "@/lib/groups/joining";
import { displayName } from "@/lib/names";
import { formatInZone } from "@/lib/time/zone";

/** Renders a helper sentence with its slot linked to the Invite links page. */
function HelperText({ sentence, inviteHref }: { sentence: HelperSentence; inviteHref: string }) {
  return (
    <>
      {sentence.before}
      {sentence.link ? (
        <Link href={inviteHref} className="font-medium text-brand-primary-text underline">
          {sentence.link}
        </Link>
      ) : null}
      {sentence.after}
    </>
  );
}

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
  timeZone: string;
}

export function PrivacyAndJoiningManager({
  groupId,
  groupName,
  initialPrivate,
  initialPolicy,
  orgDiscoveryOn,
  timeZone,
}: PrivacyAndJoiningManagerProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [isPrivate, setIsPrivate] = useState(initialPrivate);
  const [savingPrivate, setSavingPrivate] = useState(false);
  const latestPrivate = useRef(0);
  const [policy, setPolicy] = useState(initialPolicy);
  const [savingPolicy, setSavingPolicy] = useState(false);
  const [requests, setRequests] = useState<PendingRequest[] | null>(null);
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
      toast.error("Couldn't save the setting. Try again.");
      return;
    }
    toast.success(next ? "Group is now private." : "Group can be found again.");
    router.refresh();
  }

  async function changePolicy(next: JoinPolicy) {
    if (next === policy) return;
    const previous = policy;
    setPolicy(next);
    setSavingPolicy(true);
    const { data, error } = await supabase
      .from("groups")
      .update({ join_policy: next })
      .eq("id", groupId)
      .select("id");
    setSavingPolicy(false);
    if (error || !data?.length) {
      setPolicy(previous);
      toast.error("Couldn't save how people join. Try again.");
      return;
    }
    toast.success("How people join saved.");
    router.refresh();
  }

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
        if (error.code === "GJ004") setRequests((prev) => prev && prev.filter((r) => r.id !== id));
        return;
      }
      toast.success(
        approve ? `${displayName(request)} joined ${groupName}.` : "Request declined.",
      );
      setRequests((prev) => prev && prev.filter((r) => r.id !== id));
      if (approve) router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  const policyOption = JOIN_POLICY_OPTIONS.find((o) => o.value === policy);
  const inviteHref = groupPath(groupId, "/settings/invites");

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
                <HelperText sentence={privacyHelper(orgDiscoveryOn)} inviteHref={inviteHref} />
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
          <div className="space-y-2">
            <Label htmlFor="join-policy" className="text-xl font-bold text-foreground">
              How people join
            </Label>
            <Select
              items={JOIN_POLICY_OPTIONS}
              value={policy}
              onValueChange={(v) => changePolicy(parseJoinPolicy(v))}
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
              {isPrivate ? (
                <HelperText sentence={PRIVATE_POLICY_HELPER} inviteHref={inviteHref} />
              ) : (
                policyOption?.description
              )}
            </p>
          </div>
        </section>

        <section>
          <h2 className="mb-4 text-xl font-bold text-foreground">Pending join requests</h2>
          {requestsFailed ? (
            <ErrorState thing="the requests" onRetry={loadRequests} />
          ) : requests === null ? (
            <LoadingState thing="the requests" />
          ) : (
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
              emptyText={pendingRequestsEmptyText(policy)}
            />
          )}
        </section>
      </div>
    </PageContainer>
  );
}
