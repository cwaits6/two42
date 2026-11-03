"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { failureMessage } from "@/lib/errorCopy";
import {
  PRAYER_RETENTION_OPTIONS,
  PRAYER_RETENTION_PERIODS,
  parsePrayerRetention,
  prayerRetentionConfirmation,
  type PrayerRetention,
} from "@/lib/prayerRetention";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Writes the setting and reports whether a row changed. RLS filters a row the
 * caller may not update out of the statement, which then succeeds with zero
 * rows; only a returned row is a save.
 */
export async function savePrayerRetention(
  supabase: SupabaseClient<Database>,
  orgId: string,
  retention: PrayerRetention
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("organizations")
      .update({ prayer_request_retention_months: retention === "off" ? null : retention })
      .eq("id", orgId)
      .select("prayer_request_retention_months");
    return !error && (data?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

interface PrayerRetentionSettingsProps {
  /** The caller's own org, as RLS returned it; never an id the browser typed. */
  orgId: string;
  retention: PrayerRetention;
}

/** Church admin control for deleting prayer requests once they reach an age. */
export function PrayerRetentionSettings({ orgId, retention }: PrayerRetentionSettingsProps) {
  const [saved, setSaved] = useState<PrayerRetention>(retention);
  const [selected, setSelected] = useState<PrayerRetention>(retention);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const selectedLabel = PRAYER_RETENTION_OPTIONS.find((o) => o.value === String(selected))?.label;

  async function save() {
    setSaving(true);
    const ok = await savePrayerRetention(supabase, orgId, selected);
    setSaving(false);
    if (!ok) {
      toast.error(failureMessage("save the prayer request setting"));
      return;
    }
    setSaved(selected);
    setConfirming(false);
    toast.success(
      selected === "off"
        ? "Prayer requests will be kept."
        : `Prayer requests will be deleted after ${PRAYER_RETENTION_PERIODS[selected]}.`
    );
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-4">
      <Label htmlFor="prayer-retention" className="text-base">
        Old prayer requests
      </Label>
      <p className="mt-0.5 text-base text-muted-foreground">
        Prayer requests are kept unless you choose a time here. The time counts from the day a
        request was posted, and deleting happens each night.
      </p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select
          items={PRAYER_RETENTION_OPTIONS}
          value={String(selected)}
          onValueChange={(value) => value && setSelected(parsePrayerRetention(value))}
        >
          <SelectTrigger id="prayer-retention" className="w-full text-base sm:flex-1">
            <SelectValue>{selectedLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PRAYER_RETENTION_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value} className="text-base">
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="lg"
          className="text-base"
          onClick={() => (selected === "off" ? save() : setConfirming(true))}
          disabled={saving || selected === saved}
        >
          {saving && !confirming ? "Saving…" : "Save setting"}
        </Button>
      </div>
      {selected !== "off" && (
        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          pendingLabel="Saving…"
          onConfirm={save}
          {...prayerRetentionConfirmation(selected)}
        />
      )}
    </div>
  );
}
