"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { createClient } from "@/lib/supabase/client";
import { failureMessage } from "@/lib/errorCopy";
import type { ServingLinkMode } from "@/lib/serving/config";

export function ServingLinkModeForm({
  groupId,
  initialMode,
}: {
  groupId: string;
  initialMode: ServingLinkMode;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<ServingLinkMode>(initialMode);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // A write the RLS policy rejects matches zero rows without an error.
    const { data, error } = await supabase
      .from("group_settings")
      .upsert({
        group_id: groupId,
        serving_link_mode: mode,
        updated_by: user?.id,
        updated_at: new Date().toISOString(),
      })
      .select("group_id");
    setSaving(false);
    if (error || !data?.length) {
      toast.error(failureMessage("save the email setting"));
      return;
    }
    toast.success("Email setting saved.");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <Label htmlFor="serving-link-mode" className="text-lg">
            Let people respond from the email without signing in
          </Label>
          <p id="serving-link-mode-help" className="text-base text-muted-foreground">
            The sign-up and cancel buttons in serving emails work straight
            away. Turn this off to ask people to sign in first.
          </p>
        </div>
        <Switch
          id="serving-link-mode"
          aria-describedby="serving-link-mode-help"
          checked={mode === "signed"}
          onCheckedChange={(on) => setMode(on ? "signed" : "login")}
        />
      </div>
      <Button type="submit" disabled={saving || mode === initialMode}>
        {saving ? "Saving…" : "Save setting"}
      </Button>
    </form>
  );
}
