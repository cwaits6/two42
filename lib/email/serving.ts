/**
 * Serving signup emails. Email is the front door for this feature — every
 * message deep-links straight to the action it asks for.
 */
import { Resend } from "resend";
import {
  formatFromHeader,
  resolveRequestEmailBranding,
  type EmailBranding,
} from "@/lib/email/identity";
import { formatServiceDateWithYear } from "@/lib/serving/dates";
import {
  button,
  cancelTurn,
  emailLayout,
  escapeHtml,
  factLines,
  heading,
  openDateRows,
  panel,
  paragraph,
  strong,
  viewSchedule,
} from "@/supabase/functions/_shared/email-html";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export async function sendServingConfirmationEmail(opts: {
  to: string;
  name: string;
  teamName: string;
  serviceDate: string;
  attendeesLabel: string;
  cancelUrl: string;
  icsContent: string;
  branding?: EmailBranding;
}) {
  const b = opts.branding ?? (await resolveRequestEmailBranding());
  const dateLabel = formatServiceDateWithYear(opts.serviceDate);
  const { error } = await getResend().emails.send({
    from: formatFromHeader(b.orgName, b.fromAddress),
    to: opts.to,
    ...(b.replyTo ? { replyTo: b.replyTo } : {}),
    subject: `You're signed up: ${opts.teamName}, ${dateLabel}`,
    html: emailLayout(
      b.orgName,
      `${heading("You're signed up")}
${paragraph(`Hi ${escapeHtml(opts.name)}, thank you for serving with ${strong(opts.teamName)}.`)}
${panel(factLines([["When", dateLabel], ["Who", opts.attendeesLabel]]))}
${paragraph("A calendar file is attached so you can add this date to your calendar.")}
${cancelTurn(opts.cancelUrl, b.accent)}`,
    ),
    attachments: [
      {
        filename: `serving-${opts.serviceDate}.ics`,
        content: Buffer.from(opts.icsContent).toString("base64"),
      },
    ],
  });

  if (error) {
    console.error("Failed to send serving confirmation email:", error);
    throw error;
  }
}

/** Quiet heads-up to a team leader when a signup is cancelled. */
export async function sendServingCancelNoticeEmail(opts: {
  to: string;
  leaderName: string;
  memberLabel: string;
  teamName: string;
  serviceDate: string;
  servingUrl: string;
  branding?: EmailBranding;
}) {
  const b = opts.branding ?? (await resolveRequestEmailBranding());
  const dateLabel = formatServiceDateWithYear(opts.serviceDate);
  const { error } = await getResend().emails.send({
    from: formatFromHeader(b.orgName, b.fromAddress),
    to: opts.to,
    ...(b.replyTo ? { replyTo: b.replyTo } : {}),
    subject: `${opts.teamName}: ${dateLabel} is open again`,
    html: emailLayout(
      b.orgName,
      `${heading("A date opened up")}
${paragraph(`Hi ${escapeHtml(opts.leaderName)}, ${strong(opts.memberLabel)} can no longer serve with ${strong(opts.teamName)} on ${strong(dateLabel)}, so that date is open again.`)}
${button(opts.servingUrl, "View schedule", b.accent)}`,
    ),
  });

  if (error) {
    console.error("Failed to send serving cancel notice:", error);
    throw error;
  }
}

/** Leader broadcast listing the open dates, each with its own action link. */
export async function sendServingBroadcastEmail(opts: {
  to: string;
  name: string;
  teamName: string;
  fromName: string;
  message?: string;
  openDates: { date: string; url: string }[];
  scheduleUrl: string;
  branding?: EmailBranding;
}) {
  const b = opts.branding ?? (await resolveRequestEmailBranding());
  const { error } = await getResend().emails.send({
    from: formatFromHeader(b.orgName, b.fromAddress),
    to: opts.to,
    ...(b.replyTo ? { replyTo: b.replyTo } : {}),
    subject: `${opts.teamName}: dates that still need someone`,
    html: emailLayout(
      b.orgName,
      `${heading("Can you take one of these dates?")}
${paragraph(`Hi ${escapeHtml(opts.name)}, ${escapeHtml(opts.fromName)} is looking for someone from ${strong(opts.teamName)} to take the dates below. Choose a date to sign up.`)}
${opts.message ? paragraph(escapeHtml(opts.message)) : ""}
${openDateRows(
  opts.openDates.map(({ date, url }) => ({ dateLabel: formatServiceDateWithYear(date), url })),
  b.accent
)}
${viewSchedule(opts.scheduleUrl)}`,
    ),
  });

  if (error) {
    console.error("Failed to send serving broadcast email:", error);
    throw error;
  }
}
