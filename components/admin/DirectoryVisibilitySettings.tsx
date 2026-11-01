"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { failureMessage } from "@/lib/errorCopy";
import type { DirectoryVisibility } from "@/lib/directory/visibility";

interface DirectoryVisibilitySettingsProps {
  /** The caller's own org, as RLS returned it; never an id the browser typed. */
  orgId: string;
  visibility: DirectoryVisibility;
}

/** Church admin control for who a member can see in the directory. */
export function DirectoryVisibilitySettings({ orgId, visibility }: DirectoryVisibilitySettingsProps) {
  const [orgWide, setOrgWide] = useState(visibility === "org");
  const router = useRouter();
  const supabase = createClient();

  async function toggle(next: boolean) {
    setOrgWide(next);
    const { data, error } = await supabase
      .from("organizations")
      .update({ directory_visibility: next ? "org" : "shared_groups" })
      .eq("id", orgId)
      .select("directory_visibility");
    if (error || !data?.length) {
      setOrgWide(!next);
      toast.error(failureMessage("change who can see the directory"));
      return;
    }
    toast.success(
      next
        ? "Members can now see everyone in the church."
        : "Members now see only people who share a group with them."
    );
    router.refresh();
  }

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
        <Switch id="directory-visibility" checked={orgWide} onCheckedChange={toggle} />
      </div>
    </div>
  );
}
