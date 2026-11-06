"use client";

import { useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettingSave } from "@/components/admin/useSettingSave";

interface GivingSettingsProps {
  stewardsCanManage: boolean;
}

/** Church admin control for who can manage funds */
export function GivingSettings({ stewardsCanManage }: GivingSettingsProps) {
  const supabase = useMemo(() => createClient(), []);
  const { value: manageOn, saving, save } = useSettingSave(stewardsCanManage, {
    write: async (next) => {
      // An update, not an upsert: every church is provisioned with this row, and
      // site_settings has no insert policy, so an upsert is refused by RLS.
      const { data, error } = await supabase
        .from("site_settings")
        .update({
          value: next ? "stewards" : "admins",
          updated_at: new Date().toISOString(),
        })
        .eq("key", "giving_manage_mode")
        .select("key");
      return !error && (data?.length ?? 0) > 0;
    },
    saved: (next) =>
      next ? "Members can add their own funds." : "Only leaders can add and edit funds.",
    action: "update the setting",
  });

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-card px-5 py-4">
      <div>
        <Label htmlFor="giving-mode" className="text-base">
          Members can add their own funds
        </Label>
        <p className="mt-1 text-base text-muted-foreground">
          When off, only leaders can add and edit funds. When on, members
          can also add and edit a fund that goes to them. Existing funds
          stay visible either way.
        </p>
      </div>
      <Switch id="giving-mode" checked={manageOn} disabled={saving} onCheckedChange={save} />
    </div>
  );
}
