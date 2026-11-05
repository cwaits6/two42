"use client";

import { useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettingSave } from "@/components/admin/useSettingSave";
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
  // A period deletes prayer requests, so it waits here until it is confirmed.
  const [asking, setAsking] = useState<Exclude<PrayerRetention, "off"> | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const { value, saving, save } = useSettingSave<PrayerRetention>(retention, {
    write: (next) => savePrayerRetention(supabase, orgId, next),
    saved: (next) =>
      next === "off"
        ? "Prayer requests will be kept."
        : `Prayer requests will be deleted after ${PRAYER_RETENTION_PERIODS[next]}.`,
    action: "save the prayer request setting",
  });
  const shown = asking ?? value;
  const shownLabel = PRAYER_RETENTION_OPTIONS.find((o) => o.value === String(shown))?.label;

  function choose(next: PrayerRetention) {
    if (next === "off") save(next);
    else setAsking(next);
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
      <Select
        items={PRAYER_RETENTION_OPTIONS}
        value={String(shown)}
        disabled={saving}
        onValueChange={(next) => next && choose(parsePrayerRetention(next))}
      >
        <SelectTrigger id="prayer-retention" className="mt-3 w-full text-base sm:max-w-sm">
          <SelectValue>{shownLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {PRAYER_RETENTION_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value} className="text-base">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {asking !== null && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setAsking(null)}
          pendingLabel="Saving…"
          onConfirm={async () => {
            if (await save(asking)) setAsking(null);
          }}
          {...prayerRetentionConfirmation(asking)}
        />
      )}
    </div>
  );
}
