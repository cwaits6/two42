"use client";

import { useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettingSave } from "@/components/admin/useSettingSave";

interface GroupDiscoverySettingsProps {
  /** The caller's own org, as RLS returned it; never an id the browser typed. */
  orgId: string;
  discoveryOn: boolean;
}

/** Church admin control for whether members can find and request to join groups. */
export function GroupDiscoverySettings({ orgId, discoveryOn }: GroupDiscoverySettingsProps) {
  const supabase = useMemo(() => createClient(), []);
  const { value: on, saving, save } = useSettingSave(discoveryOn, {
    write: async (next) => {
      const { data, error } = await supabase
        .from("organizations")
        .update({ group_discovery: next })
        .eq("id", orgId)
        .select("group_discovery");
      return !error && (data?.length ?? 0) > 0;
    },
    saved: (next) =>
      next
        ? "Members can now find and request to join groups."
        : "Members now see only the groups they belong to.",
    action: "update the setting",
  });

  return (
    <div className="rounded-2xl border border-border bg-card px-5">
      <div className="flex items-start justify-between gap-4 py-4">
        <div>
          <Label htmlFor="group-discovery" className="text-base">
            Members can find and request to join groups
          </Label>
          <p className="mt-1 text-base text-muted-foreground">
            When off, members see only the groups they belong to. Leaders can still add people
            directly. Each group can be more private than this setting, never less.
          </p>
        </div>
        <Switch id="group-discovery" className="mt-0.5 shrink-0" checked={on} disabled={saving} onCheckedChange={save} />
      </div>
    </div>
  );
}
