"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { PageHeader } from "@/components/layout/PageHeader";
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
  privacyHelper,
  type HelperSentence,
  type JoinPolicy,
} from "@/lib/groups/joining";

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
  const [policy, setPolicy] = useState(initialPolicy);
  const [savingPolicy, setSavingPolicy] = useState(false);
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

  const policyOption = JOIN_POLICY_OPTIONS.find((o) => o.value === policy);
  const inviteHref = groupPath(groupId, "/settings/invites");

  return (
    <PageContainer>
      <PageHeader
        title="Privacy and joining"
        subtitle={groupName}
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
      </div>
    </PageContainer>
  );
}
