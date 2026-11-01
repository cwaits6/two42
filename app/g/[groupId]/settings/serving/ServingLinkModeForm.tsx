"use client";

import { useState } from "react";
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
import type { ServingLinkMode } from "@/lib/serving/config";

const SERVING_LINK_MODE_OPTIONS: { value: ServingLinkMode; label: string }[] = [
  { value: "signed", label: "Signed links — members act without logging in (recommended)" },
  { value: "login", label: "Login required — links redirect to the login page first" },
];

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
      toast.error("Couldn't save the link mode. Please try again.");
      return;
    }
    toast.success("Serving link mode saved.");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="serving-link-mode" className="text-lg">
          Serving email link mode
        </Label>
        <Select
          items={SERVING_LINK_MODE_OPTIONS}
          value={mode}
          onValueChange={(v) => setMode(v === "login" ? "login" : "signed")}
        >
          <SelectTrigger id="serving-link-mode" className="w-full text-lg py-5">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SERVING_LINK_MODE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        type="submit"
        size="lg"
        disabled={saving}
      >
        {saving ? "Saving…" : "Save link mode"}
      </Button>
    </form>
  );
}
