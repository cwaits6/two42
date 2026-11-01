"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { failureMessage } from "@/lib/errorCopy";
import {
  GROUP_CREATION_POLICIES,
  parseGroupCreationPolicy,
  type GroupCreationPolicy,
} from "@/lib/groups/creation";

const POLICY_COPY: Record<GroupCreationPolicy, { label: string; description: string; saved: string }> = {
  open: {
    label: "Open",
    description: "Any member can create a group. It goes live at once.",
    saved: "Members can now create groups.",
  },
  approval: {
    label: "Approval required",
    description: "A member asks for a group. A church admin approves it.",
    saved: "Members now request a group and a church admin approves it.",
  },
  admins: {
    label: "Church admins only",
    description: "Only church admins create groups.",
    saved: "Only church admins can create groups now.",
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

/** Church admin control for who can create groups. */
export function OrgGroupControls({ orgId, policy }: OrgGroupControlsProps) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [saved, setSaved] = useState(policy);
  const [selected, setSelected] = useState(policy);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const { data, error } = await supabase
      .from("organizations")
      .update({ group_creation_policy: selected })
      .eq("id", orgId)
      .select("group_creation_policy");
    setSaving(false);
    if (error || !data?.length) {
      toast.error(failureMessage("save who can create groups"));
      return;
    }
    setSaved(selected);
    toast.success(POLICY_COPY[selected].saved);
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-4">
      <div className="space-y-2">
        <Label htmlFor="group-creation-policy" className="text-base">
          Who can create groups
        </Label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select
            items={POLICY_OPTIONS}
            value={selected}
            onValueChange={(raw) => setSelected(parseGroupCreationPolicy(raw))}
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
          <Button onClick={save} disabled={saving || selected === saved}>
            {saving ? "Saving…" : "Save rule"}
          </Button>
        </div>
        <p className="text-base text-muted-foreground">{POLICY_COPY[selected].description}</p>
      </div>
    </div>
  );
}
