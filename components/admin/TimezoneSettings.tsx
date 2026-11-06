"use client";

import { useMemo, useState } from "react";
import { DateTime } from "luxon";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
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
import { useSettingSave } from "@/components/admin/useSettingSave";
import { FieldError, invalidFieldProps } from "@/components/ui/field-error";
import { isValidTimeZone } from "@/lib/time/zone";

export type TimeZoneOption = { value: string; label: string };

// Written out rather than asked of Intl: the trigger renders on the server and
// again in the browser, whose time zone names can differ.
const US_ZONE_NAMES: Record<string, string> = {
  "America/New_York": "Eastern Time (New York)",
  "America/Chicago": "Central Time (Chicago)",
  "America/Denver": "Mountain Time (Denver)",
  "America/Phoenix": "Arizona Time (Phoenix)",
  "America/Los_Angeles": "Pacific Time (Los Angeles)",
  "America/Anchorage": "Alaska Time (Anchorage)",
  "Pacific/Honolulu": "Hawaii Time (Honolulu)",
};

/** Listed first, in the order the country reads them. */
export const US_TIME_ZONES = Object.keys(US_ZONE_NAMES);

/**
 * What a person reads for a zone; the stored value stays the IANA id. US zones
 * by name, others as "London, Europe (UTC+01:00)" with the offset at `now`,
 * and a zone this runtime doesn't know as its id.
 */
export function timeZoneLabel(zone: string, now: DateTime = DateTime.now()): string {
  const named = US_ZONE_NAMES[zone];
  if (named) return named;
  const parts = zone.replaceAll("_", " ").split("/");
  const local = now.setZone(zone);
  if (parts.length === 1 || !local.isValid) return zone;
  return `${parts[parts.length - 1]}, ${parts[0]} (UTC${local.toFormat("ZZ")})`;
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

/** Church admin control for the one zone every event time is entered and shown in. */
export function TimezoneSettings({ orgId, timezone }: TimezoneSettingsProps) {
  const [invalid, setInvalid] = useState<string | undefined>();
  const supabase = useMemo(() => createClient(), []);
  const { value: selected, saving, save } = useSettingSave(timezone, {
    write: (next) => saveTimeZone(supabase, orgId, next),
    saved: () => "Time zone saved.",
    action: "save the time zone",
  });
  const options = useMemo(() => timeZoneOptions(timezone), [timezone]);
  const usOptions = options.filter((o) => US_TIME_ZONES.includes(o.value));
  const otherOptions = options.filter((o) => !US_TIME_ZONES.includes(o.value));
  const selectedLabel = options.find((o) => o.value === selected)?.label ?? selected;

  function choose(next: string) {
    if (!isValidTimeZone(next)) {
      setInvalid("Choose a time zone from the list.");
      return;
    }
    setInvalid(undefined);
    save(next);
  }

  return (
    <div className="rounded-2xl border border-border bg-card px-5 py-4">
      <Label htmlFor="org-timezone" className="text-base">
        Time zone
      </Label>
      <p className="mt-0.5 text-base text-muted-foreground">
        Every event time is entered and shown in this zone.
      </p>
      <Select
        items={options}
        value={selected}
        disabled={saving}
        onValueChange={(value) => value && choose(value)}
      >
        <SelectTrigger
          id="org-timezone"
          className="mt-3 w-full text-base sm:max-w-sm"
          {...invalidFieldProps("org-timezone", invalid)}
        >
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
            <SelectLabel>Other time zones</SelectLabel>
            {otherOptions.map((option) => (
              <SelectItem key={option.value} value={option.value} className="text-base">
                {option.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <FieldError fieldId="org-timezone" message={invalid} />
    </div>
  );
}
