"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import {
  GROUP_CREATION_POLICY_OPTIONS,
  parseGroupCreationPolicy,
  type GroupCreationPolicy,
} from "@/lib/groups/creation";

const SAVED_TOAST: Record<GroupCreationPolicy, string> = {
  open: "Members can now create groups.",
  approval: "Members now request a group and an admin approves it.",
  admins: "Only org admins can create groups now.",
};

interface OrgGroupControlsProps {
  /** The caller's own org, as RLS returned it; never an id the browser typed. */
  orgId: string;
  policy: GroupCreationPolicy;
}

/** Org admin controls for groups; the create policy today, discovery when it lands. */
export function OrgGroupControls({ orgId, policy }: OrgGroupControlsProps) {
  const router = useRouter();
  const [current, setCurrent] = useState(policy);

  async function change(raw: string | null) {
    const next = parseGroupCreationPolicy(raw);
    if (next === current) return;
    const previous = current;
    setCurrent(next);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("organizations")
      .update({ group_creation_policy: next })
      .eq("id", orgId)
      .select("group_creation_policy");
    if (error || !data?.length) {
      setCurrent(previous);
      toast.error("Failed to update the setting.");
      return;
    }
    toast.success(SAVED_TOAST[next]);
    router.refresh();
  }

  const option = GROUP_CREATION_POLICY_OPTIONS.find((o) => o.value === current);

  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-4">
      <div className="space-y-2">
        <Label htmlFor="group-creation-policy" className="text-base">
          Who can create groups
        </Label>
        <Select items={GROUP_CREATION_POLICY_OPTIONS} value={current} onValueChange={change}>
          <SelectTrigger id="group-creation-policy" className="h-12 w-full text-base sm:max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {GROUP_CREATION_POLICY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {option && <p className="text-base text-muted-foreground">{option.description}</p>}
      </div>
    </div>
  );
}
