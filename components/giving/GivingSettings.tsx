"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { failureMessage } from "@/lib/errorCopy";

interface GivingSettingsProps {
  stewardsCanManage: boolean;
}

/** Church admin control for who can manage funds */
export function GivingSettings({ stewardsCanManage }: GivingSettingsProps) {
  const [manageOn, setManageOn] = useState(stewardsCanManage);
  const router = useRouter();
  const supabase = createClient();

  async function toggleManage(next: boolean) {
    setManageOn(next);
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
    if (error || !data?.length) {
      setManageOn(!next);
      toast.error(failureMessage("update the setting"));
      return;
    }
    toast.success(
      next ? "Members can add their own funds." : "Only leaders can add and edit funds."
    );
    router.refresh();
  }

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
      <Switch id="giving-mode" checked={manageOn} onCheckedChange={toggleManage} />
    </div>
  );
}
