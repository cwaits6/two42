// Supabase Edge Function: send-serving-reminders
//
// Two modes, two pg_cron entries — schedule defined in
// supabase/migrations/20260729000000_reminder_cron_schedules.sql (not here,
// so it survives a point-in-time restore or self-host from this repo):
//
//   - "send-serving-reminders-daily": remind attendees of covered Sundays
//     (per-team reminder_days — see serving_team_settings)
//   - "send-serving-monthly-broadcast": broadcast open Sundays on the 1st
//
// Runs with the service key (BYPASSRLS), so tenant isolation lives in the
// query text: iterates every active organization and filters each query on
// org_id explicitly (CWA-10 Phase 3, #212).

// Pinned exactly (CWA-45): deno.lock's integrity entry only governs CI, while
// `supabase functions deploy` re-resolves this URL through its own bundler —
// so the version must live in the specifier itself. Matches what the app's
// package-lock.json resolves for ^2.103.3; bump both together (no Renovate
// rule covers this URL).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.9";
import {
  formatFromHeader,
  parseAddress,
  resolveEmailBranding,
  type EmailBranding,
} from "../_shared/branding.ts";
import { escapeHtml } from "../_shared/html.ts";
import { nextSunday, upcomingSundays } from "../_shared/sundays.ts";
import { resolveServiceKey } from "../_shared/service-key.ts";
import {
  forEachOrg,
  listActiveOrgs,
  OrgRunError,
  summarize,
  type ItemFailure,
  type OrgListClient,
  type OrgRunCounts,
} from "../_shared/orgs.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SECRET_KEY = resolveServiceKey();
const SITE_URL = Deno.env.get("SITE_URL") || "https://incouragers.org";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "two42 <noreply@incouragers.org>";
const APP_NAME = Deno.env.get("APP_NAME") || "two42";
const BRAND_COLOR = Deno.env.get("BRAND_COLOR") || "#B85C38";
const SERVING_LINK_SECRET = Deno.env.get("SERVING_LINK_SECRET");
const SERVING_LINK_MODE = Deno.env.get("SERVING_LINK_MODE") || "signed";

// The one place the service client is constructed. ReturnType of this
// CONCRETE zero-arg factory binds createClient's generics at the real call —
// unlike ReturnType<typeof createClient> (the unbound generic function),
// which resolves them to a different, incompatible instantiation; that is why
// CWA-45 kept a hand-written SupabaseClient<any, "public", any> alias here.
// Bound through the factory, the type tracks whatever the pinned 2.110.9
// call actually returns, so a version bump needs no re-verification.
function createServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
}
type ServiceClient = ReturnType<typeof createServiceClient>;

// The From: address keeps the platform domain (deliverability: SPF/DKIM are
// configured for it); only the display name and Reply-To vary per org
// (CWA-56). Mirrors lib/email/identity.ts.
const PLATFORM_ADDRESS = parseAddress(EMAIL_FROM);
const BRANDING_DEFAULTS = { displayName: APP_NAME, accent: BRAND_COLOR };

// ── HMAC token (same format as lib/serving/links.ts) ─────────────────────────

interface ServingLinkPayload {
  v: 1;
  a: "signup" | "cancel";
  g: string;
  d: string;
  p: string;
  exp: number;
}

function b64url(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function b64urlStr(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

async function hmacSign(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

async function createToken(
  payload: Omit<ServingLinkPayload, "v" | "exp">,
  secret: string,
  ttlDays = 60
): Promise<string> {
  const full: ServingLinkPayload = {
    v: 1,
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlDays * 86400,
  };
  const payloadB64 = b64urlStr(JSON.stringify(full));
  return `${payloadB64}.${await hmacSign(payloadB64, secret)}`;
}

// ── Date formatting ───────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// ── Email ─────────────────────────────────────────────────────────────────────

async function sendEmail(
  opts: { to: string; subject: string; html: string; refId: string; branding: EmailBranding },
): Promise<boolean> {
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      // Raw REST call, so the Reply-To field is snake_case `reply_to` — not
      // the camelCase `replyTo` the SDK uses in lib/email/resend.ts.
      body: JSON.stringify({
        from: formatFromHeader(opts.branding.orgName, PLATFORM_ADDRESS),
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        ...(opts.branding.replyTo ? { reply_to: opts.branding.replyTo } : {}),
      }),
    });
    if (!res.ok) {
      // Log the profile id, not the email address (PII) — the Resend error
      // body is what's actionable here.
      console.error("Resend error for profile", opts.refId, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Resend request failed for profile", opts.refId, err);
    return false;
  }
}

function wrap(inner: string, orgName: string): string {
  return `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:40px 20px;">
    ${inner}
    <p style="font-size:14px;color:#78716c;margin-top:40px;">&mdash; The ${escapeHtml(orgName)} Team</p>
  </div>`;
}

// ── Shared: resolve link mode ─────────────────────────────────────────────────

// Org-scoped: the key-only read errored outright at two orgs (the bug class
// closed for the app layer in lib/serving/config.ts and recorded for this
// function in docs/security/service-role-inventory.md). An unresolvable link
// mode is an org-level failure — throw so the per-org boundary catches it
// instead of silently degrading every link to unsigned.
async function resolveCanSign(supabase: ServiceClient, orgId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("site_settings")
    .select("value")
    .eq("org_id", orgId)
    .eq("key", "serving_link_mode")
    .maybeSingle();
  if (error) throw new Error(`site_settings query failed: ${error.message}`);
  const mode = (data?.value ?? SERVING_LINK_MODE) === "login" ? "login" : "signed";
  return mode === "signed" && !!SERVING_LINK_SECRET;
}

// ── Daily mode: remind attendees of the next covered Sunday ──────────────────

async function runDaily(
  supabase: ServiceClient,
  orgId: string,
  canSign: boolean,
  branding: EmailBranding
): Promise<OrgRunCounts> {
  const todayDow = new Date().getDay();

  let sent = 0;
  let sendFailures = 0;
  const itemFailures: ItemFailure[] = [];

  // Only process teams whose reminder_days include today
  const { data: teamSettings, error: teamSettingsError } = await supabase
    .from("serving_team_settings")
    .select("group_id")
    .eq("org_id", orgId)
    .eq("enabled", true)
    .contains("reminder_days", [todayDow]);

  if (teamSettingsError) {
    // Genuinely org-level: no team loop has begun, so there is nothing to
    // isolate per-team yet (itemFailures is necessarily empty here).
    throw new OrgRunError(`serving_team_settings query failed: ${teamSettingsError.message}`, { sent, sendFailures, itemFailures });
  }
  if (!teamSettings?.length) return { sent, sendFailures, itemFailures };

  // Per-team fault isolation (CWA-50): each team's body runs inside a try so
  // one team's failure is recorded in itemFailures and the org's remaining
  // teams still run. Query failures inside the loop throw plain Errors (not
  // OrgRunError) so the catch records them per-team instead of aborting the
  // org; `sent` / `sendFailures` are function-scoped, so partial counts
  // survive a caught team.
  for (const { group_id } of teamSettings) {
    try {
      const { data: group, error: groupError } = await supabase
        .from("member_groups")
        .select("name")
        .eq("org_id", orgId)
        .eq("id", group_id)
        .maybeSingle();
      if (groupError) {
        // Recorded via the catch below — this used to be a silent skip whose
        // only record was a log line, invisible to the run summary.
        throw new Error(`member_groups query failed: ${groupError.message}`);
      }
      if (!group) continue; // a genuinely absent group is not an error
      const teamName = group.name as string;

      const sunday = nextSunday();

      // The embed carries no org_id filter and needs none: the parent row is
      // org-filtered below and composite (col, org_id) FKs keep the traversal
      // inside this tenant. See the note in _shared/orgs.ts.
      const { data: signup, error: signupError } = await supabase
        .from("serving_signups")
        .select("id, serving_signup_attendees(profiles(id, first_name, preferred_name, email))")
        .eq("org_id", orgId)
        .eq("group_id", group_id)
        .eq("service_date", sunday)
        .maybeSingle();
      if (signupError) {
        throw new Error(`serving_signups query failed: ${signupError.message}`);
      }

      if (!signup) continue; // open Sunday — no reminder to send

      const attendees = (signup.serving_signup_attendees ?? []) as unknown as Array<{
        profiles: { id: string; first_name: string | null; preferred_name: string | null; email: string | null } | null;
      }>;

      for (const { profiles: p } of attendees) {
        if (!p?.email) continue;
        const name = escapeHtml(p.preferred_name || p.first_name || "Friend");
        const safeTeam = escapeHtml(teamName);
        const dateLabel = escapeHtml(formatDate(sunday));

        let cancelUrl = `${SITE_URL}/serving/${group_id}`;
        if (canSign) {
          cancelUrl = `${SITE_URL}/serving/go?token=${await createToken(
            { a: "cancel", g: group_id, d: sunday, p: p.id },
            SERVING_LINK_SECRET!
          )}`;
        }

        if (await sendEmail({
          to: p.email,
          refId: p.id,
          branding,
          subject: `Reminder: you're serving this Sunday with the ${teamName}`,
          html: wrap(`
          <h1 style="color:${branding.accent};font-size:28px;">See you Sunday!</h1>
          <p style="font-size:18px;line-height:1.6;color:#44403c;">
            Hi ${name}, just a reminder that you&rsquo;re signed up to serve with the
            <strong>${safeTeam}</strong> this Sunday.
          </p>
          <div style="background:#fef3c7;padding:20px;border-radius:8px;margin:20px 0;">
            <p style="font-size:18px;margin:0;color:#44403c;">
              <strong>When:</strong> ${dateLabel}
            </p>
          </div>
          <p style="font-size:14px;color:#78716c;">
            Can&rsquo;t make it?
            <a href="${cancelUrl}" style="color:${branding.accent};">Click here to cancel</a>
            so someone else can cover.
          </p>
        `, branding.orgName),
        })) sent++;
        else sendFailures++;
      }
    } catch (err) {
      // Keyed by group_id, never the team name — names are org-defined free
      // text (tenant content) and fragile as diagnostic keys.
      console.error(
        "[org %s] team %s failed, continuing with remaining teams:",
        orgId,
        group_id,
        err,
      );
      itemFailures.push({
        item: group_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { sent, sendFailures, itemFailures };
}

// ── Monthly mode: broadcast open Sundays to the whole team ───────────────────

async function runMonthly(
  supabase: ServiceClient,
  orgId: string,
  canSign: boolean,
  branding: EmailBranding
): Promise<OrgRunCounts> {
  let sent = 0;
  let sendFailures = 0;
  const itemFailures: ItemFailure[] = [];

  const { data: teamSettings, error: teamSettingsError } = await supabase
    .from("serving_team_settings")
    .select("group_id, window_weeks")
    .eq("org_id", orgId)
    .eq("enabled", true);

  if (teamSettingsError) {
    // Genuinely org-level: no team loop has begun, so there is nothing to
    // isolate per-team yet (itemFailures is necessarily empty here).
    throw new OrgRunError(`serving_team_settings query failed: ${teamSettingsError.message}`, { sent, sendFailures, itemFailures });
  }
  if (!teamSettings?.length) return { sent, sendFailures, itemFailures };

  // Per-team fault isolation (CWA-50): each team's body runs inside a try so
  // one team's failure is recorded in itemFailures and the org's remaining
  // teams still run. Query failures inside the loop throw plain Errors (not
  // OrgRunError) so the catch records them per-team instead of aborting the
  // org; `sent` / `sendFailures` are function-scoped, so partial counts
  // survive a caught team.
  for (const { group_id, window_weeks } of teamSettings) {
    try {
      let teamSent = 0;
      const { data: group, error: groupError } = await supabase
        .from("member_groups")
        .select("name")
        .eq("org_id", orgId)
        .eq("id", group_id)
        .maybeSingle();
      if (groupError) {
        // Recorded via the catch below — this used to be a silent skip whose
        // only record was a log line, invisible to the run summary.
        throw new Error(`member_groups query failed: ${groupError.message}`);
      }
      if (!group) continue; // a genuinely absent group is not an error
      const teamName = group.name as string;

      const sundays = upcomingSundays(window_weeks ?? 8);

      // Find which Sundays are already covered
      const { data: signups, error: signupsError } = await supabase
        .from("serving_signups")
        .select("service_date")
        .eq("org_id", orgId)
        .eq("group_id", group_id)
        .in("service_date", sundays);
      if (signupsError) {
        throw new Error(`serving_signups query failed: ${signupsError.message}`);
      }

      const covered = new Set((signups ?? []).map((s) => s.service_date as string));
      const openDates = sundays.filter((d) => !covered.has(d));

      if (!openDates.length) continue; // all covered — nothing to broadcast

      // Get all team members. The profiles embed is org-safe by FK traversal
      // from the org-filtered profile_groups parent — see _shared/orgs.ts.
      const { data: members, error: membersError } = await supabase
        .from("profile_groups")
        .select("profiles(id, first_name, preferred_name, email, email_announcements)")
        .eq("org_id", orgId)
        .eq("group_id", group_id);
      if (membersError) {
        throw new Error(`profile_groups query failed: ${membersError.message}`);
      }

      for (const row of members ?? []) {
        const m = row.profiles as unknown as {
          id: string;
          first_name: string | null;
          preferred_name: string | null;
          email: string | null;
          email_announcements: boolean;
        } | null;
        if (!m?.email || m.email_announcements === false) continue;

        const name = escapeHtml(m.preferred_name || m.first_name || "Friend");
        const safeTeam = escapeHtml(teamName);

        const rows = await Promise.all(
          openDates.map(async (date) => {
            let signupUrl = `${SITE_URL}/serving/${group_id}`;
            if (canSign) {
              signupUrl = `${SITE_URL}/serving/go?token=${await createToken(
                { a: "signup", g: group_id, d: date, p: m.id },
                SERVING_LINK_SECRET!
              )}`;
            }
            return `
            <table role="presentation" width="100%" style="border-bottom:1px solid #e7e5e4;">
              <tr>
                <td style="padding:14px 0;font-size:18px;color:#44403c;">${escapeHtml(formatDate(date))}</td>
                <td align="right" style="padding:14px 0;">
                  <a href="${signupUrl}"
                     style="display:inline-block;background-color:${branding.accent};color:white;padding:10px 20px;text-decoration:none;border-radius:8px;font-size:16px;white-space:nowrap;">
                    I&rsquo;ll do it
                  </a>
                </td>
              </tr>
            </table>`;
          })
        );

        if (await sendEmail({
          to: m.email,
          refId: m.id,
          branding,
          subject: `${teamName}: open Sundays for the coming weeks`,
          html: wrap(`
          <h1 style="color:${branding.accent};font-size:28px;">Can you take a Sunday?</h1>
          <p style="font-size:18px;line-height:1.6;color:#44403c;">
            Hi ${name}, here are the upcoming Sundays for the <strong>${safeTeam}</strong>
            that still need a volunteer. Tap a button and you&rsquo;re signed up.
          </p>
          ${rows.join("")}
          <p style="font-size:14px;color:#78716c;margin-top:24px;">
            Want to see the full schedule?
            <a href="${SITE_URL}/serving/${group_id}" style="color:${branding.accent};">View the team page</a>
          </p>
        `, branding.orgName),
        })) { sent++; teamSent++; }
        else sendFailures++;
      }

      // Log broadcast (service key bypasses RLS; sent_by = null marks automated;
      // org_id comes from the row context being processed, not a constant).
      // Recorded, not thrown, on failure — the emails have already gone out,
      // so this must not read as a failed team send; it reaches the summary's
      // failedItems[] directly (CWA-50 retired the old "log line is the only
      // record" caveat).
      const { error: broadcastError } = await supabase.from("serving_broadcasts").insert({
        group_id,
        sent_by: null,
        org_id: orgId,
        subject: `${teamName}: monthly open-Sunday broadcast`,
        open_dates: openDates,
        recipient_count: teamSent,
      });
      if (broadcastError) {
        // Full error object, not .message — serving_broadcasts has composite
        // (group_id, org_id) FKs, whose violations put the offending key values
        // in `details`/`hint` while `message` stays generic.
        console.error(
          "[org %s] serving_broadcasts insert failed for group %s:",
          orgId,
          group_id,
          broadcastError,
        );
        itemFailures.push({
          item: group_id,
          error: `serving_broadcasts insert failed: ${broadcastError.message}`,
        });
      }
    } catch (err) {
      // Keyed by group_id, never the team name — names are org-defined free
      // text (tenant content) and fragile as diagnostic keys.
      console.error(
        "[org %s] team %s failed, continuing with remaining teams:",
        orgId,
        group_id,
        err,
      );
      itemFailures.push({
        item: group_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { sent, sendFailures, itemFailures };
}

// ── Entry point ───────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  let mode = "daily";
  // An absent body is normal (the daily cron posts nothing); a present but
  // unparseable body is an alarm — it means the monthly job's {"mode":
  // "monthly"} did not arrive, and the month's open-Sunday broadcast silently
  // runs as a daily instead. Detection latency for that is ~30 days, so the
  // two conditions are distinguished rather than both swallowed.
  const rawBody = await req.text().catch(() => "");
  if (rawBody.trim()) {
    try {
      const body = JSON.parse(rawBody);
      if (body?.mode === "monthly") mode = "monthly";
    } catch (err) {
      console.error("request body present but unparseable, defaulting to daily:", err);
    }
  }

  try {
    const supabase = createServiceClient();
    // Cast: structurally checking the full SupabaseClient against OrgListClient
    // trips TS2589 (excessively deep instantiation) on current supabase-js.
    // Re-verified at the pinned 2.110.9 (CWA-45): a direct structural
    // assignment still trips TS2589, so the pin does not remove this cast.
    const orgs = await listActiveOrgs(supabase as unknown as OrgListClient);
    const summary = summarize(
      await forEachOrg(orgs, async (org) => {
        // Resolved inside the per-org callback so a failure here is caught by
        // this org's boundary instead of aborting the whole run.
        const canSign = await resolveCanSign(supabase, org.id);
        // resolveEmailBranding is total (never throws): a malformed branding
        // row degrades to the env defaults, not an org-level failure.
        const branding = resolveEmailBranding(org.branding, BRANDING_DEFAULTS, org.slug);
        return mode === "monthly"
          ? await runMonthly(supabase, org.id, canSign, branding)
          : await runDaily(supabase, org.id, canSign, branding);
      }),
    );

    if (summary.failed.length > 0 || summary.failedItems.length > 0 || summary.emailsFailed > 0) {
      console.error(
        "%s run completed with failures: %d/%d orgs failed, %d teams failed, %d emails rejected",
        mode,
        summary.failed.length,
        summary.orgs,
        summary.failedItems.length,
        summary.emailsFailed,
      );
    }

    // Status contract: see summarize() in _shared/orgs.ts — 500 when any org
    // OR any team failed (pg_net records it in net._http_response; nothing
    // retries a 5xx, so no duplicate sends), 200 only for a clean run.
    return new Response(
      JSON.stringify({ mode, message: `Sent ${summary.emailsSent} emails`, ...summary }),
      {
        status: summary.failed.length > 0 || summary.failedItems.length > 0 ? 500 : 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  } catch (err) {
    // Total failure (e.g. listActiveOrgs threw) — no org ran. The body means
    // net._http_response carries a diagnosis instead of an empty 500; the
    // per-org-failure case above also returns 500 but with `failed[]` populated.
    console.error("%s reminder run aborted before completion:", mode, err);
    return new Response(
      JSON.stringify({ mode, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
