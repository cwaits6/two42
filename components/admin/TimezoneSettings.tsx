"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DateTime } from "luxon";
import { toast } from "sonner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Database } from "@/lib/supabase/database.types";
import { isValidTimeZone } from "@/lib/time/zone";

/** Listed first, in the order the country reads them. */
export const US_TIME_ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

export type TimeZoneOption = { value: string; label: string };

/** "America/New York (UTC-04:00)": the name, underscores read as spaces, with its offset at `now`. */
export function timeZoneLabel(zone: string, now: DateTime = DateTime.now()): string {
  return `${zone.replaceAll("_", " ")} (UTC${now.setZone(zone).toFormat("ZZ")})`;
}

/**
 * The US zones, then every other zone this runtime knows. `current` stays
 * listed even when the runtime's list lacks it, so the trigger never shows
 * a raw value with no matching item.
 */
export function timeZoneOptions(current: string, now: DateTime = DateTime.now()): TimeZoneOption[] {
  const rest = Intl.supportedValuesOf("timeZone").filter((zone) => !US_TIME_ZONES.includes(zone));
  const zones = [...US_TIME_ZONES, ...rest];
  if (!zones.includes(current)) zones.unshift(current);
  return zones.map((value) => ({ value, label: timeZoneLabel(value, now) }));
}

/**
 * Writes the zone and reports whether a row changed. RLS filters a row the
 * caller may not update out of the statement, which then succeeds with zero
 * rows; only a returned row is a save.
 */
export async function saveTimeZone(
  supabase: SupabaseClient<Database>,
  orgId: string,
  timezone: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("organizations")
    .update({ timezone })
    .eq("id", orgId)
    .select("timezone");
  return !error && (data?.length ?? 0) > 0;
}

interface TimezoneSettingsProps {
  /** The caller's own org, as RLS returned it; never an id the browser typed. */
  orgId: string;
  /** The org's current zone, resolved by the server. */
  timezone: string;
}

/** Org admin control for the one zone every event time is entered and shown in. */
export function TimezoneSettings({ orgId, timezone }: TimezoneSettingsProps) {
  const [saved, setSaved] = useState(timezone);
  const [selected, setSelected] = useState(timezone);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const options = useMemo(() => timeZoneOptions(saved), [saved]);
  const usOptions = options.filter((o) => US_TIME_ZONES.includes(o.value));
  const otherOptions = options.filter((o) => !US_TIME_ZONES.includes(o.value));
  const selectedLabel = options.find((o) => o.value === selected)?.label ?? selected;

  async function save() {
    if (!isValidTimeZone(selected)) {
      toast.error("Choose a time zone from the list.");
      return;
    }
    setSaving(true);
    const ok = await saveTimeZone(supabase, orgId, selected);
    setSaving(false);
    if (!ok) {
      setSelected(saved);
      toast.error("Failed to save the time zone.");
      return;
    }
    setSaved(selected);
    toast.success("Time zone saved. Event times now show in it.");
    router.refresh();
  }

  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-4">
      <Label htmlFor="org-timezone" className="text-base">
        Time zone
      </Label>
      <p className="mt-0.5 text-base text-muted-foreground">
        Every event time is entered and shown in this zone.
      </p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select items={options} value={selected} onValueChange={(value) => value && setSelected(value)}>
          <SelectTrigger id="org-timezone" className="w-full text-base sm:flex-1">
            <SelectValue>{selectedLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectLabel>United States</SelectLabel>
              {usOptions.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-base">
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
            <SelectGroup>
              <SelectLabel>All zones</SelectLabel>
              {otherOptions.map((option) => (
                <SelectItem key={option.value} value={option.value} className="text-base">
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button
          size="lg"
          className="text-base"
          onClick={save}
          disabled={saving || selected === saved}
        >
          {saving ? "Saving..." : "Save time zone"}
        </Button>
      </div>
    </div>
  );
}
