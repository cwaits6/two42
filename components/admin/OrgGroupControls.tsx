"use client";

import { useMemo } from "react";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { useSettingSave } from "@/components/admin/useSettingSave";
import {
  GROUP_CREATION_POLICIES,
  parseGroupCreationPolicy,
  type GroupCreationPolicy,
} from "@/lib/groups/creation";

const POLICY_COPY: Record<GroupCreationPolicy, { label: string; description: string; saved: string }> = {
  open: {
    label: "Open",
    description: "Any member can add a group. It goes live at once.",
    saved: "Members can now add groups.",
  },
  approval: {
    label: "Approval required",
    description: "A member asks for a group. A church admin approves it.",
    saved: "Members now request a group and a church admin approves it.",
  },
  admins: {
    label: "Church admins only",
    description: "Only church admins add groups.",
    saved: "Only church admins can add groups now.",
  },
};

const POLICY_OPTIONS = GROUP_CREATION_POLICIES.map((value) => ({
  value,
  ...POLICY_COPY[value],
}));

interface OrgGroupControlsProps {
  /** The caller's own org, as RLS returned it; never an id the browser typed. */
  orgId: string;
  policy: GroupCreationPolicy;
}

/** Church admin control for who can add groups. */
export function OrgGroupControls({ orgId, policy }: OrgGroupControlsProps) {
  const supabase = useMemo(() => createClient(), []);
  const { value: selected, saving, save } = useSettingSave(policy, {
    write: async (next) => {
      const { data, error } = await supabase
        .from("organizations")
        .update({ group_creation_policy: next })
        .eq("id", orgId)
        .select("group_creation_policy");
      return !error && (data?.length ?? 0) > 0;
    },
    saved: (next) => POLICY_COPY[next].saved,
    action: "save who can add groups",
  });

  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-4">
      <div className="space-y-2">
        <Label htmlFor="group-creation-policy" className="text-base">
          Who can add groups
        </Label>
        <Select
          items={POLICY_OPTIONS}
          value={selected}
          onValueChange={(raw) => save(parseGroupCreationPolicy(raw))}
          disabled={saving}
        >
          <SelectTrigger id="group-creation-policy" className="h-12 w-full text-base sm:max-w-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {POLICY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-base">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-base text-muted-foreground">{POLICY_COPY[selected].description}</p>
      </div>
    </div>
  );
}
