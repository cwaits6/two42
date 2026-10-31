import { cache } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { siteConfig } from "@/lib/config";
import { isValidTimeZone } from "@/lib/time/zone";

/**
 * The caller's own org's time zone, memoized per request with cache() like
 * getOrgBranding(). RLS narrows organizations to the caller's org, which is
 * why no explicit filter is needed — and why this must stay on
 * createClient(): a service-role client would read every org.
 *
 * Never throws: a page must not 500 over its zone. A query error, no visible
 * row (an anonymous caller) or a zone this runtime's Intl does not know all
 * degrade to siteConfig.timeZone and are logged. Server components resolve
 * the zone here once and pass it down; client components never read it.
 */
export const getOrgTimeZone = cache(async (): Promise<string> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.from("organizations").select("timezone").maybeSingle();
    if (error) {
      console.error("Failed to load the org time zone, using the default:", error);
      return siteConfig.timeZone;
    }
    if (!data) {
      console.warn("No organization row visible for this request; using the default time zone");
      return siteConfig.timeZone;
    }
    if (!isValidTimeZone(data.timezone)) {
      console.error("Unknown org time zone %s; using the default", data.timezone);
      return siteConfig.timeZone;
    }
    return data.timezone;
  } catch (err) {
    console.error("Failed to load the org time zone, using the default:", err);
    return siteConfig.timeZone;
  }
});

/**
 * The zone of `orgId`, for routes with no session to scope a read — the
 * calendar subscriptions. `orgId` must come from an already-validated anchor
 * such as the subscription-token row. Degrades like getOrgTimeZone().
 */
export async function orgTimeZoneById(supabase: SupabaseClient, orgId: string): Promise<string> {
  const { data, error } = await supabase
    .from("organizations")
    .select("timezone")
    .eq("id", orgId)
    .maybeSingle();
  if (error || !data || !isValidTimeZone(data.timezone)) {
    console.error("Failed to load the time zone for org %s; using the default:", orgId, error);
    return siteConfig.timeZone;
  }
  return data.timezone;
}
