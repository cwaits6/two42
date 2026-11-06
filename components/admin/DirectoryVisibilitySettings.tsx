"use client";

import { useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useSettingSave } from "@/components/admin/useSettingSave";
import type { DirectoryVisibility } from "@/lib/directory/visibility";

interface DirectoryVisibilitySettingsProps {
  /** The caller's own org, as RLS returned it; never an id the browser typed. */
  orgId: string;
  visibility: DirectoryVisibility;
}

/** Church admin control for who a member can see in the directory. */
export function DirectoryVisibilitySettings({ orgId, visibility }: DirectoryVisibilitySettingsProps) {
  const supabase = useMemo(() => createClient(), []);
  const { value: orgWide, saving, save } = useSettingSave(visibility === "org", {
    write: async (next) => {
      const { data, error } = await supabase
        .from("organizations")
        .update({ directory_visibility: next ? "org" : "shared_groups" })
        .eq("id", orgId)
        .select("directory_visibility");
      return !error && (data?.length ?? 0) > 0;
    },
    saved: (next) =>
      next
        ? "Members can now see everyone in the church."
        : "Members now see only people who share a group with them.",
    action: "change who can see the directory",
  });

  return (
    <div className="rounded-2xl border border-border bg-card px-5">
      <div className="flex items-center justify-between gap-4 py-4">
        <div>
          <Label htmlFor="directory-visibility" className="text-base">
            Directory visible to the whole church
          </Label>
          <p className="mt-0.5 text-base text-muted-foreground">
            Otherwise members see only people who share a group with them.
          </p>
        </div>
        <Switch id="directory-visibility" checked={orgWide} disabled={saving} onCheckedChange={save} />
      </div>
    </div>
  );
}
