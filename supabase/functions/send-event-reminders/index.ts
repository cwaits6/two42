// Supabase Edge Function: send-event-reminders
//
// Two modes. The pg_cron entry is defined in migrations (not here, so it
// survives a point-in-time restore or self-host from this repo):
//
//   - "send-event-reminders-daily" ({"mode":"dates"}), at 15:00, 16:00 and
//     17:00 UTC: remind the people who replied Yes or Maybe before each date
//     of an event, as many days ahead as the event chose, recorded in
//     event_reminder_passes / event_reminder_sends so a rerun never sends
//     twice — see _shared/event-reminders.ts. The first firing sends; the
//     other two finish what a failed or cut-off firing left. Scheduled by
//     supabase/migrations/20261117000000_event_reminder_choices.sql.
//   - before dates (no body, or a body with no mode): the mode the job ran
//     with before it posted a mode, with no sent record and no reminder for the
//     later dates of a repeating event. Kept so a function deployed ahead of
//     the migration that schedules the dates mode behaves as before; remove
//     it, with sendEmail() and _shared/event-recipients.ts, once a release
//     has run on the dates mode.
//
// A body that names any other mode, or does not parse, is refused with 400
// and sends nothing.
//
// Runs with the service key (BYPASSRLS), so tenant isolation lives in the
// query text: iterates every active organization and filters each query on
// org_id explicitly.

// Pinned exactly: deno.lock's integrity entry only governs CI, while
// `supabase functions deploy` re-resolves this URL through its own bundler —
// so the version must live in the specifier itself. Matches what the app's
// package-lock.json resolves for ^2.103.3; bump both together (no Renovate
// rule covers this URL).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.9";
import { serviceKeyCallerOnly } from "../_shared/caller-auth.ts";
import {
  formatFromHeader,
  parseAddress,
  resolveEmailBranding,
  type EmailBranding,
} from "../_shared/branding.ts";
import {
  resolveEventReminderRecipients,
  type EventRecipientClient,
} from "../_shared/event-recipients.ts";
import {
  type EventReminder,
  type EventRemindersClient,
  reminderMode,
  runEventReminders,
} from "../_shared/event-reminders.ts";
import { formatReminderDate } from "../_shared/event-time.ts";
import { listGroups, type GroupClient } from "../_shared/groups.ts";
import { eventReminderEmail } from "../_shared/email-html.ts";
import { resolveServiceKey } from "../_shared/service-key.ts";
import { reserveEmailQuota } from "../_shared/quota.ts";
import { eventReminderIdempotencyKey, sendThroughResend } from "../_shared/resend.ts";
import {
  forEachOrg,
  listActiveOrgs,
  OrgRunError,
  summarize,
  type ItemFailure,
  type Org,
  type OrgListClient,
  type OrgRunCounts,
} from "../_shared/orgs.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SECRET_KEY = resolveServiceKey();

// The one place the service client is constructed. ReturnType of this
// CONCRETE zero-arg factory binds createClient's generics at the real call —
// unlike ReturnType<typeof createClient> (the unbound generic function),
// which resolves them to a different, incompatible instantiation; that is why
// this file once kept a hand-written SupabaseClient<any, "public", any> alias.
// Bound through the factory, the type tracks whatever the pinned 2.110.9
// call actually returns, so a version bump no longer needs the ALIAS
// re-derived — but the OrgListClient cast in Deno.serve still does (see its
// TS2589 note), and the pin still has to move in lockstep with
// package-lock.json. Mirrored byte-for-byte in send-serving-reminders.
function createServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
}
type ServiceClient = ReturnType<typeof createServiceClient>;
// The app's one canonical host — the origin of every link in this mail. The
// non-prefixed twin of NEXT_PUBLIC_SITE_URL (Deno cannot read Next's env).
const SITE_URL = Deno.env.get("SITE_URL") || "https://two42.io";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "two42 <noreply@two42.io>";
const APP_NAME = Deno.env.get("APP_NAME") || "two42";
const BRAND_COLOR = Deno.env.get("BRAND_COLOR") || "#B85C38";

// The platform From: address — the fallback for every org without a
// verified org_email_domains row whose domain passes the SENDING_DOMAIN gate
// in _shared/branding.ts. Mirrors lib/email/identity.ts.
const PLATFORM_ADDRESS = parseAddress(EMAIL_FROM);
const BRANDING_DEFAULTS = {
  displayName: APP_NAME,
  accent: BRAND_COLOR,
  platformAddress: PLATFORM_ADDRESS,
};

// A firing stops starting work here, inside the edge runtime's 150 s request
// limit and the 120 s pg_net timeout the job's migration sets, so the caller
// records the response. What is left waits for the next firing of the cycle.
const EVENT_BUDGET_MS = 90_000;
// Resend allows 10 requests a second per team.
const SEND_SPACING_MS = 110;

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
        from: formatFromHeader(opts.branding.orgName, opts.branding.fromAddress),
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

// ── Dates mode: one reminder per person per date of an event ─────────────────

async function runDatesMode(supabase: ServiceClient, orgs: Org[]) {
  const startedAt = Date.now();
  let lastSendAt = 0;
  return await runEventReminders(supabase as unknown as EventRemindersClient, orgs, {
    now: new Date(startedAt),
    elapsed: () => Date.now() - startedAt,
    budgetMs: EVENT_BUDGET_MS,
    sender: (org) => {
      const branding = resolveEmailBranding(
        org.branding,
        BRANDING_DEFAULTS,
        org.id,
        org.org_email_domains[0] ?? null,
      );
      return async (r: EventReminder) => {
        const email = eventReminderEmail({
          orgName: branding.orgName,
          accent: branding.accent,
          name: r.preferredName || r.firstName || "Friend",
          title: r.date.title,
          dateLabel: formatReminderDate(r.date.startIso, org.timezone),
          location: r.date.location,
          eventUrl: `${SITE_URL}/g/${r.date.groupId}${r.date.linkPath}`,
        });
        const wait = lastSendAt + SEND_SPACING_MS - Date.now();
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        lastSendAt = Date.now();
        return await sendThroughResend({
          apiKey: RESEND_API_KEY,
          refId: r.profileId,
          idempotencyKey: eventReminderIdempotencyKey({
            eventId: r.date.recordEventId,
            occurrenceDate: r.date.occurrenceDate,
            profileId: r.profileId,
          }),
          // Raw REST call, so the Reply-To field is snake_case `reply_to`.
          payload: {
            from: formatFromHeader(branding.orgName, branding.fromAddress),
            to: r.email,
            subject: email.subject,
            html: email.html,
            ...(branding.replyTo ? { reply_to: branding.replyTo } : {}),
          },
        });
      };
    },
  });
}

// ── Before dates: per-org run ─────────────────────────────────────────────────

async function runBeforeDates(
  supabase: ServiceClient,
  org: Org,
  branding: EmailBranding,
): Promise<OrgRunCounts> {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const baseUrl = SITE_URL;

  let sent = 0;
  let sendFailures = 0;
  const itemFailures: ItemFailure[] = [];

  // Genuinely org-level: no group loop has begun, so there is nothing to
  // isolate per-group yet. Same TS2589 reason as the OrgListClient cast in
  // Deno.serve.
  let groups;
  try {
    groups = await listGroups(supabase as unknown as GroupClient, org.id);
  } catch (err) {
    throw new OrgRunError(err instanceof Error ? err.message : String(err), { sent, sendFailures });
  }

  // Per-group fault isolation: each group's body runs inside a try so one
  // group's failure is recorded in itemFailures and the org's remaining
  // groups still run. Query failures inside the loop throw plain Errors (not
  // OrgRunError) so the catch records them per-group instead of aborting the
  // org; `sent` / `sendFailures` are function-scoped, so partial counts
  // survive a caught group.
  for (const group of groups) {
    try {
      const { data: events, error: eventsError } = await supabase
        .from("events")
        .select("id, title, start_time, location")
        .eq("org_id", org.id)
        .eq("group_id", group.id)
        .eq("is_cancelled", false)
        .gte("start_time", now.toISOString())
        .lte("start_time", tomorrow.toISOString());
      if (eventsError) throw new Error(`events query failed: ${eventsError.message}`);
      if (!events?.length) continue;

      for (const event of events) {
        // Before the quota reservation: a zone Intl rejects throws here and
        // fails the group, rather than spending the org's cap on no sends.
        const eventDate = formatReminderDate(event.start_time, org.timezone);

        const recipients = await resolveEventReminderRecipients(
          supabase as unknown as EventRecipientClient,
          org.id,
          group.id,
          event.id,
        );

        // Reserve once per event batch against the org's daily cap,
        // for the final filtered set only. A cap-hit is a deliberate skip of
        // this event's batch: logged, not a sendFailure or an itemFailure, so
        // it does not change the 200/500 contract — and reserveEmailQuota
        // never throws, so it adds no new failure surface to the loop.
        const allowed = await reserveEmailQuota(supabase, org.id, recipients.length);
        if (!allowed) {
          console.warn(
            "[org %s] event %s: daily email cap reached, skipping %d reminder(s)",
            org.id,
            event.id,
            recipients.length,
          );
          continue;
        }

        for (const profile of recipients) {
          if (await sendEmail({
            to: profile.email,
            refId: profile.id,
            branding,
            ...eventReminderEmail({
              orgName: branding.orgName,
              accent: branding.accent,
              name: profile.preferred_name || profile.first_name || "Friend",
              title: event.title,
              dateLabel: eventDate,
              location: event.location,
              eventUrl: `${baseUrl}/g/${group.id}/calendar/${event.id}`,
            }),
          })) sent++;
          else sendFailures++;
        }
      }
    } catch (err) {
      // Keyed by group id, never the group name — names are org-defined free
      // text (tenant content) and fragile as diagnostic keys.
      console.error(
        "[org %s] group %s failed, continuing with remaining groups:",
        org.id,
        group.id,
        err,
      );
      itemFailures.push({
        item: group.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { sent, sendFailures, itemFailures };
}

// ── Entry point ───────────────────────────────────────────────────────────────

Deno.serve(serviceKeyCallerOnly(async (req) => {
  const mode = reminderMode(await req.text());
  if (!mode) {
    console.error("request body names no mode this job runs, nothing sent");
    return new Response(JSON.stringify({ error: "unrecognised body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createServiceClient();
    // Cast: structurally checking the full SupabaseClient against OrgListClient
    // trips TS2589 (excessively deep instantiation) on current supabase-js.
    // Re-verified at the pinned 2.110.9: a direct structural
    // assignment still trips TS2589, so the pin does not remove this cast.
    const orgs = await listActiveOrgs(supabase as unknown as OrgListClient);

    if (mode === "dates") {
      const run = await runDatesMode(supabase, orgs);
      // One line at most, and none for a firing that did nothing.
      if (run.due > 0 || run.failed.length > 0 || run.failedItems.length > 0) {
        console.log(
          "dates run: %d date(s) due, %d sent, %d rejected, %d capped, %d org(s) failed, %d event(s) failed%s%s",
          run.due,
          run.emailsSent,
          run.emailsFailed,
          run.capped,
          run.failed.length,
          run.failedItems.length,
          run.budgetExhausted ? ", stopped at the time budget" : "",
          run.rateLimited ? ", stopped at Resend's rate limit" : "",
        );
      }
      // Running out of time or being rate limited is not a failure: the next
      // firing of the cycle picks up what is left through the sent record.
      return new Response(JSON.stringify({ mode, ...run }), {
        status: run.failed.length > 0 || run.failedItems.length > 0 ? 500 : 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const summary = summarize(await forEachOrg(orgs, (org) =>
      // resolveEmailBranding is total (never throws): a malformed branding
      // row degrades to the env defaults, not an org-level failure.
      runBeforeDates(
        supabase,
        org,
        resolveEmailBranding(org.branding, BRANDING_DEFAULTS, org.id, org.org_email_domains[0] ?? null),
      )));
    if (summary.failed.length > 0 || summary.failedItems.length > 0 || summary.emailsFailed > 0) {
      console.error(
        "run completed with failures: %d/%d orgs failed, %d groups failed, %d emails rejected",
        summary.failed.length,
        summary.orgs,
        summary.failedItems.length,
        summary.emailsFailed,
      );
    }
    // Status contract: see summarize() in _shared/orgs.ts — 500 when any org
    // OR any group failed (pg_net records it in net._http_response; nothing
    // retries a 5xx, so no duplicate sends), 200 only for a clean run.
    return new Response(
      JSON.stringify({ message: `Sent ${summary.emailsSent} reminder emails`, ...summary }),
      {
        status: summary.failed.length > 0 || summary.failedItems.length > 0 ? 500 : 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    // Total failure (e.g. listActiveOrgs threw) — no org ran. The body means
    // net._http_response carries a diagnosis instead of an empty 500; the
    // per-org-failure case above also returns 500 but with `failed[]` populated.
    console.error("reminder run aborted before completion:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}));
