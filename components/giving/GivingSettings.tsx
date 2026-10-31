"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

interface GivingSettingsProps {
  stewardsCanManage: boolean;
  dashboardTile: boolean;
}

/** Admin controls for the Give page: who can manage funds, dashboard tile */
export function GivingSettings({
  stewardsCanManage,
  dashboardTile,
}: GivingSettingsProps) {
  const [manageOn, setManageOn] = useState(stewardsCanManage);
  const [tileOn, setTileOn] = useState(dashboardTile);
  const router = useRouter();
  const supabase = createClient();

  async function saveSetting(
    key: string,
    value: string,
    revert: () => void,
    successMessage: string
  ) {
    const { error } = await supabase.from("site_settings").upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
    });
    if (error) {
      revert();
      toast.error("Failed to update the setting.");
      return;
    }
    toast.success(successMessage);
    router.refresh();
  }

  function toggleManage(next: boolean) {
    setManageOn(next);
    saveSetting(
      "giving_manage_mode",
      next ? "stewards" : "admins",
      () => setManageOn(!next),
      next
        ? "Members can now add their own funds."
        : "Only leaders can now add and edit funds."
    );
  }

  function toggleTile(next: boolean) {
    setTileOn(next);
    saveSetting(
      "giving_dashboard_tile",
      next ? "on" : "off",
      () => setTileOn(!next),
      next
        ? "The Give tile will show on the dashboard."
        : "The Give tile is hidden from the dashboard."
    );
  }

  return (
    <div className="divide-y divide-border rounded-2xl border border-border bg-card px-5">
      <div className="flex items-center justify-between gap-4 py-4">
        <div>
          <Label htmlFor="giving-mode" className="text-base">
            Members can add their own funds
          </Label>
          <p className="mt-0.5 text-sm text-muted-foreground">
            When off, only leaders can add and edit funds. When on, members
            can also add and edit a fund that goes to them. Existing funds
            stay visible either way.
          </p>
        </div>
        <Switch id="giving-mode" checked={manageOn} onCheckedChange={toggleManage} />
      </div>
      <div className="flex items-center justify-between gap-4 py-4">
        <div>
          <Label htmlFor="giving-tile" className="text-base">
            Show a Give tile on the dashboard
          </Label>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Appears in the quick actions whenever at least one fund is
            collecting.
          </p>
        </div>
        <Switch id="giving-tile" checked={tileOn} onCheckedChange={toggleTile} />
      </div>
    </div>
  );
}
