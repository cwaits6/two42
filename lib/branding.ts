/**
 * Per-org branding. The source of truth is
 * organizations.branding (jsonb); the NEXT_PUBLIC_* env values in
 * lib/config.ts survive only as last-resort fallback defaults so
 * self-hosters keep working with an empty branding row.
 */
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { siteConfig } from "@/lib/config";
import { HEX } from "@/lib/contrast";

// The contrast math and the write-path accent guard live in
// lib/contrast.ts so the client-side branding form can share them; this
// module stays their canonical server-side import site.
export {
  ACCENT_CONTRAST_REFERENCE,
  ACCENT_CONTRAST_MIN,
  relativeLuminance,
  contrastRatio,
  validateAccent,
  type AccentValidation,
} from "@/lib/contrast";

export type OrgBranding = {
  display_name: string;
  logo_url: string | null;
  accent: string;
  reply_to: string | null;
};

export const BRANDING_DEFAULTS: OrgBranding = {
  display_name: siteConfig.name,
  logo_url: null,
  accent: siteConfig.colors.primary,
  reply_to: null,
};

// display_name reaches RFC 5322 headers (From:, and three Subject: lines in
// lib/email/resend.ts) and the document <title>; strip C0/C1 control
// characters at this boundary so no sink has to. formatFromHeader() keeps its
// own CR/LF strip as defence-in-depth.
export const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;

// reply_to becomes an RFC 5322 Reply-To header via the Resend API, which
// rejects malformed addresses — and sendInviteEmail throws on rejection, so
// one bad character in the branding column would 500 every invite send.
// Deliberately conservative: over-rejecting yields no Reply-To header, which
// is the pre-branding behavior and strictly better than a failed send.
export const EMAIL = /^[^\s@<>,;:"\\]+@[^\s@<>,;:"\\]+\.[^\s@<>,;:"\\]+$/;

/**
 * Merge a raw branding jsonb value onto the defaults. Falls back per-key —
 * an invalid accent must not discard a valid display_name. A non-object
 * (array, scalar, null) falls back entirely.
 */
export function resolveBranding(raw: unknown): OrgBranding {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return BRANDING_DEFAULTS;
  }
  const b = raw as Record<string, unknown>;
  const name =
    typeof b.display_name === "string" ? b.display_name.replace(CONTROL, "").trim() : "";
  const replyTo = typeof b.reply_to === "string" ? b.reply_to.trim() : null;
  const replyToValid = replyTo !== null && replyTo.length <= 254 && EMAIL.test(replyTo);
  if (replyTo !== null && replyTo !== "" && !replyToValid) {
    // The one silent fallback worth a signal: a dropped Reply-To is far more
    // surprising than a dropped color, and the cause (a branding column) is
    // nowhere near the symptom (mail replying to noreply@).
    console.warn("Ignoring malformed branding.reply_to; sending without a Reply-To header");
  }
  return {
    display_name: name !== "" ? name : BRANDING_DEFAULTS.display_name,
    logo_url: typeof b.logo_url === "string" ? b.logo_url : null,
    accent:
      typeof b.accent === "string" && HEX.test(b.accent)
        ? b.accent
        : BRANDING_DEFAULTS.accent,
    reply_to: replyToValid ? replyTo : null,
  };
}

/**
 * The request org's branding, memoized per request with React cache() so
 * generateMetadata and the layout body share one query (Supabase calls are
 * not fetch-memoized). RLS narrows organizations to the request org, so no
 * explicit org filter is needed — but only because this uses createClient();
 * a service-role client would bypass RLS and require one.
 *
 * Never throws: branding must not be able to 500 a page. Any error or
 * missing row degrades to BRANDING_DEFAULTS.
 */
export const getOrgBranding = cache(async (): Promise<OrgBranding> => {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("organizations")
      .select("branding")
      .maybeSingle();
    if (error) {
      console.error("Failed to load org branding, using defaults:", error);
      return BRANDING_DEFAULTS;
    }
    if (!data) {
      // maybeSingle() reports zero rows as { data: null, error: null }, so
      // this branch is NOT reachable via `error` above. Not "unconfigured" —
      // the request resolved no org row at all: most likely
      // NEXT_PUBLIC_ORG_SLUG does not match the seeded org's slug
      // (lib/org.ts), or the permissive SELECT policy regressed. The defaults
      // are byte-identical to org #1's backfilled branding, so without this
      // line a totally non-functional read path is invisible in the logs.
      console.warn("No organization row visible for this request; using branding defaults");
      return BRANDING_DEFAULTS;
    }
    return resolveBranding(data.branding);
  } catch (err) {
    console.error("Failed to load org branding, using defaults:", err);
    return BRANDING_DEFAULTS;
  }
});
