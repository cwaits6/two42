import { createClient } from "@/lib/supabase/server";
import { isPrayerRetentionMonths, type PrayerRetention } from "@/lib/prayerRetention";
import { logError, logWarn } from "@/lib/log";

/**
 * The caller's org's prayer request setting, read through the cookie-bound
 * request client, which returns only the caller's own organizations row.
 * Null when it can't be told, including while the app is deployed ahead of the
 * column: the page shows an error rather than claiming the setting is off.
 */
export async function getPrayerRetention(): Promise<PrayerRetention | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("prayer_request_retention_months")
    .maybeSingle();
  if (error) {
    logError("Failed to load the prayer request setting", error);
    return null;
  }
  if (!data) {
    logWarn("No organization row visible for this request; prayer request setting unknown");
    return null;
  }
  const months = data.prayer_request_retention_months;
  if (months === null) return "off";
  if (isPrayerRetentionMonths(months)) return months;
  logError("Unknown prayer request period", undefined, { ids: { months } });
  return null;
}
