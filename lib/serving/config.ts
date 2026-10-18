import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 'signed' — serving email links act without logging in (HMAC-verified).
 * 'login' — links send members through the normal login first.
 * The group's settings row wins; SERVING_LINK_MODE is the self-hoster
 * default.
 */
export type ServingLinkMode = "signed" | "login";

export function defaultServingLinkMode(): ServingLinkMode {
  return process.env.SERVING_LINK_MODE === "login" ? "login" : "signed";
}

export async function getServingLinkMode(
  supabase: SupabaseClient,
  orgId: string,
  groupId: string
): Promise<ServingLinkMode> {
  // Both predicates are required: on a service-role client a bare read
  // matches every group's row the moment a second one exists, making
  // maybeSingle() error and silently fall back to the env default.
  const { data, error } = await supabase
    .from("group_settings")
    .select("serving_link_mode")
    .eq("org_id", orgId)
    .eq("group_id", groupId)
    .maybeSingle();
  if (error) {
    // Fail closed. This function decides whether HMAC-signed email links may
    // act with no login session, so a failed read must not silently authorize
    // token-only actions at a group that configured 'login'. A read failure and
    // an unconfigured setting are different conditions: only the latter falls
    // through to the env default below.
    console.error(
      "Failed to load serving_link_mode for group %s — failing closed to 'login':",
      groupId,
      error
    );
    return "login";
  }

  // data === null here means genuinely unconfigured, not failed.
  return data?.serving_link_mode === "login" || data?.serving_link_mode === "signed"
    ? data.serving_link_mode
    : defaultServingLinkMode();
}
