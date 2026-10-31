import type { SupabaseClient } from "@supabase/supabase-js";
import { contrastRatio, HEX } from "@/lib/contrast";
import type { GroupSettings } from "@/lib/types";

export type GroupSettingsValues = Pick<
  GroupSettings,
  | "weekly_zoom_url"
  | "zoom_meeting_time"
  | "weekly_prayer_call_url"
  | "weekly_prayer_call_time"
  | "serving_link_mode"
  | "calendar_meeting_details"
>;

export const GROUP_SETTINGS_DEFAULTS: GroupSettingsValues = {
  weekly_zoom_url: null,
  zoom_meeting_time: null,
  weekly_prayer_call_url: null,
  weekly_prayer_call_time: null,
  serving_link_mode: null,
  calendar_meeting_details: true,
};

/**
 * The group's settings row, or the defaults when none has been saved yet.
 * A failed read is thrown rather than reported as the defaults: the About
 * editor saves these values back, and an outage must not read as "blank".
 * The client is a parameter and so untyped as to privilege; `orgId` must be
 * the caller's already-validated org and both predicates are mandatory.
 */
export async function getGroupSettings(
  supabase: SupabaseClient,
  orgId: string,
  groupId: string
): Promise<GroupSettingsValues> {
  const { data, error } = await supabase
    .from("group_settings")
    .select(
      "weekly_zoom_url, zoom_meeting_time, weekly_prayer_call_url, weekly_prayer_call_time, serving_link_mode, calendar_meeting_details"
    )
    .eq("org_id", orgId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (error) {
    console.error("Failed to load group settings for group %s:", groupId, error);
    throw new Error(`Failed to load group settings: ${error.message}`);
  }
  if (!data) return GROUP_SETTINGS_DEFAULTS;
  return {
    weekly_zoom_url: data.weekly_zoom_url ?? null,
    zoom_meeting_time: data.zoom_meeting_time ?? null,
    weekly_prayer_call_url: data.weekly_prayer_call_url ?? null,
    weekly_prayer_call_time: data.weekly_prayer_call_time ?? null,
    serving_link_mode:
      data.serving_link_mode === "login" || data.serving_link_mode === "signed"
        ? data.serving_link_mode
        : null,
    calendar_meeting_details: data.calendar_meeting_details ?? true,
  };
}

// The group color is a chip background and a date tile, so it must carry
// legible text: white when the color is dark enough, Espresso when it is
// light enough. A color that can carry neither is rejected.
const WHITE = "#FFFFFF";
const ESPRESSO = "#2A211A";
const MIN_RATIO = 4.5;

export type GroupColorValidation =
  | { ok: true; color: string }
  | { ok: false; reason: string };

/** Write-path guard for the group color; HEX is the CSS-injection boundary. */
export function validateGroupColor(raw: unknown): GroupColorValidation {
  if (typeof raw !== "string" || !HEX.test(raw)) {
    return { ok: false, reason: "Use a 6-digit hex color such as #B85C38." };
  }
  const onWhite = contrastRatio(raw, WHITE);
  const onEspresso = contrastRatio(raw, ESPRESSO);
  if (onWhite < MIN_RATIO && onEspresso < MIN_RATIO) {
    return {
      ok: false,
      reason: `${raw} reads at ${onWhite.toFixed(2)}:1 under white text and ${onEspresso.toFixed(2)}:1 under dark text; 4.5:1 against one of them is required.`,
    };
  }
  return { ok: true, color: raw };
}

/**
 * The text color to lay over a validated group color: white where it reads
 * at 4.5:1, Espresso otherwise. Callers pass only colors that came through
 * validateGroupColor() or the HEX-gated membership loader.
 */
export function groupTextColor(color: string): string {
  return contrastRatio(color, WHITE) >= MIN_RATIO ? WHITE : ESPRESSO;
}
