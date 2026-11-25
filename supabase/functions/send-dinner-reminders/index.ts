// Supabase Edge Function: send-dinner-reminders
//
// The day before each dinner club dinner, emails the people at its table
// who have not said Not going: the time, the host, the address and who is
// coming. Scheduled as "send-dinner-reminders-daily" at 15:00, 16:00 and
// 17:00 UTC by supabase/migrations/20261203000000_dinner_club.sql; the
// first firing sends and the other two finish what a failed or cut-off
// firing left, through the sent record in dinner_reminder_passes /
// dinner_reminder_sends — see _shared/dinner-reminders.ts.
//
// Runs with the service key (BYPASSRLS), so tenant isolation lives in the
// query text: iterates every active organization and filters each query on
// org_id explicitly.

// Pinned exactly, as in send-event-reminders: bump both together.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.110.9";
import { serviceKeyCallerOnly } from "../_shared/caller-auth.ts";
import { formatFromHeader, parseAddress, resolveEmailBranding } from "../_shared/branding.ts";
import {
  type DinnerReminder,
  type DinnerRemindersClient,
  runDinnerReminders,
} from "../_shared/dinner-reminders.ts";
import { formatReminderDate } from "../_shared/event-time.ts";
import { dinnerReminderEmail, greetingName } from "../_shared/email-html.ts";
import { resolveServiceKey } from "../_shared/service-key.ts";
import { dinnerReminderIdempotencyKey, sendThroughResend } from "../_shared/resend.ts";
import { listActiveOrgs, type OrgListClient } from "../_shared/orgs.ts";
import { logError, logInfo } from "../_shared/log.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SECRET_KEY = resolveServiceKey();
// The app's one canonical host: the origin of every link in this mail.
const SITE_URL = Deno.env.get("SITE_URL") || "https://two42.io";
const EMAIL_FROM = Deno.env.get("EMAIL_FROM") || "two42 <noreply@two42.io>";
const APP_NAME = Deno.env.get("APP_NAME") || "two42";
const BRAND_COLOR = Deno.env.get("BRAND_COLOR") || "#B85C38";

const BRANDING_DEFAULTS = {
  displayName: APP_NAME,
  accent: BRAND_COLOR,
  platformAddress: parseAddress(EMAIL_FROM),
};

// Inside the edge runtime's 150 s request limit and the job's 120 s pg_net
// timeout; what is left waits for the next firing of the cycle.
const BUDGET_MS = 90_000;
// Resend allows 10 requests a second per team.
const SEND_SPACING_MS = 110;

Deno.serve(serviceKeyCallerOnly(async () => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
    // Cast: a structural check of the full client trips TS2589 (excessively
    // deep instantiation), as in send-event-reminders.
    const orgs = await listActiveOrgs(supabase as unknown as OrgListClient);
    const startedAt = Date.now();
    let lastSendAt = 0;

    const run = await runDinnerReminders(supabase as unknown as DinnerRemindersClient, orgs, {
      now: new Date(startedAt),
      elapsed: () => Date.now() - startedAt,
      budgetMs: BUDGET_MS,
      sender: (org) => {
        const branding = resolveEmailBranding(org.branding, BRANDING_DEFAULTS, org.id, org.org_email_domains[0] ?? null);
        return async (r: DinnerReminder) => {
          const email = dinnerReminderEmail({
            orgName: branding.orgName,
            accent: branding.accent,
            name: greetingName(r.preferredName, r.firstName),
            seasonTitle: r.details.seasonTitle,
            dateLabel: formatReminderDate(r.dinner.startIso, org.timezone),
            hostNames: r.details.hostNames,
            address: r.details.address,
            coming: r.details.coming,
            pageUrl: `${SITE_URL}/g/${r.dinner.groupId}/dinner-club`,
          });
          const wait = lastSendAt + SEND_SPACING_MS - Date.now();
          if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
          lastSendAt = Date.now();
          return await sendThroughResend({
            apiKey: RESEND_API_KEY,
            refId: r.profileId,
            idempotencyKey: dinnerReminderIdempotencyKey({
              dinnerId: r.dinner.dinnerId,
              dinnerDate: r.dinner.dinnerDate,
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

    if (run.due > 0 || run.failed.length > 0 || run.failedItems.length > 0) {
      logInfo("dinner reminder run", {
        route: "send-dinner-reminders",
        ids: {
          due: run.due,
          sent: run.emailsSent,
          rejected: run.emailsFailed,
          capped: run.capped,
          orgsFailed: run.failed.length,
          dinnersFailed: run.failedItems.length,
          stoppedAtTimeBudget: Number(run.budgetExhausted),
          stoppedAtRateLimit: Number(run.rateLimited),
        },
      });
    }
    return new Response(JSON.stringify(run), {
      status: run.failed.length > 0 || run.failedItems.length > 0 ? 500 : 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    logError("dinner reminder run aborted before completion", err, { route: "send-dinner-reminders" });
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}));
