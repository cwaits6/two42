/**
 * Serving signup emails. Email is the front door for this feature — every
 * message deep-links straight to the action it asks for.
 */
import { Resend } from "resend";
import { escapeHtml } from "@/lib/email/resend";
import {
  formatFromHeader,
  resolveRequestEmailBranding,
  type EmailBranding,
} from "@/lib/email/identity";
import { formatServiceDateWithYear } from "@/lib/serving/sundays";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

const bodyText = `font-size: 18px; line-height: 1.6; color: #44403c;`;
const footer = `font-size: 14px; color: #78716c; margin-top: 40px;`;

function bigButton(accent: string): string {
  return `display: inline-block; background-color: ${accent}; color: white; padding: 16px 32px; text-decoration: none; border-radius: 8px; font-size: 18px; margin-top: 20px;`;
}

// orgName, not fromName — every caller passes b.orgName, and this file's
// sendServingBroadcastEmail also has an opts.fromName holding a MEMBER's name.
function wrap(inner: string, orgName: string): string {
  return `
    <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
      ${inner}
      <p style="${footer}">&mdash; The ${escapeHtml(orgName)} Team</p>
    </div>
  `;
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
    html: wrap(`
      <h1 style="color: ${b.accent}; font-size: 28px;">You're all set!</h1>
      <p style="${bodyText}">
        Hi ${escapeHtml(opts.name)}, thank you for serving with the
        <strong>${escapeHtml(opts.teamName)}</strong>.
      </p>
      <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 20px 0;">
        <p style="font-size: 18px; margin: 0; color: #44403c;">
          <strong>When:</strong> ${dateLabel}
        </p>
        <p style="font-size: 18px; margin: 8px 0 0; color: #44403c;">
          <strong>Who:</strong> ${escapeHtml(opts.attendeesLabel)}
        </p>
      </div>
      <p style="${bodyText}">
        A calendar invitation is attached so you can add it to your calendar.
      </p>
      <p style="${footer}">
        Can&rsquo;t make it after all? No problem &mdash;
        <a href="${opts.cancelUrl}" style="color: ${b.accentLight};">click here to cancel</a>
        and the Sunday will open back up for someone else.
      </p>
    `, b.orgName),
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
    html: wrap(`
      <h1 style="color: ${b.accent}; font-size: 28px;">A Sunday opened up</h1>
      <p style="${bodyText}">
        Hi ${escapeHtml(opts.leaderName)},
        <strong>${escapeHtml(opts.memberLabel)}</strong> can no longer serve with the
        <strong>${escapeHtml(opts.teamName)}</strong> on <strong>${dateLabel}</strong>,
        so that Sunday is open again.
      </p>
      <a href="${opts.servingUrl}" style="${bigButton(b.accent)}">View the Schedule</a>
    `, b.orgName),
  });

  if (error) {
    console.error("Failed to send serving cancel notice:", error);
    throw error;
  }
}

/** Leader broadcast listing the open Sundays, each with its own action link. */
export async function sendServingBroadcastEmail(opts: {
  to: string;
  name: string;
  teamName: string;
  fromName: string;
  message?: string;
  openDates: { date: string; url: string }[];
  branding?: EmailBranding;
}) {
  const b = opts.branding ?? (await resolveRequestEmailBranding());
  const rows = opts.openDates
    .map(
      ({ date, url }) => `
        <table role="presentation" width="100%" style="border-bottom: 1px solid #e7e5e4;">
          <tr>
            <td style="padding: 14px 0; font-size: 18px; color: #44403c;">
              ${formatServiceDateWithYear(date)}
            </td>
            <td align="right" style="padding: 14px 0;">
              <a href="${url}"
                 style="display: inline-block; background-color: ${b.accent}; color: white; padding: 10px 20px; text-decoration: none; border-radius: 8px; font-size: 16px; white-space: nowrap;">
                I&rsquo;ll do it
              </a>
            </td>
          </tr>
        </table>`
    )
    .join("");

  const { error } = await getResend().emails.send({
    from: formatFromHeader(b.orgName, b.fromAddress),
    to: opts.to,
    ...(b.replyTo ? { replyTo: b.replyTo } : {}),
    subject: `${opts.teamName}: Sundays that still need someone`,
    html: wrap(`
      <h1 style="color: ${b.accent}; font-size: 28px;">Can you take a Sunday?</h1>
      <p style="${bodyText}">
        Hi ${escapeHtml(opts.name)}, ${escapeHtml(opts.fromName)} is looking for
        volunteers from the <strong>${escapeHtml(opts.teamName)}</strong> for the
        Sundays below. Tap a button and you&rsquo;re signed up &mdash; that&rsquo;s it.
      </p>
      ${opts.message ? `<p style="${bodyText}">${escapeHtml(opts.message)}</p>` : ""}
      ${rows}
      <p style="${footer}">
        Already spoken for? You can always see who&rsquo;s covering each week at
        <a href="${b.baseUrl}/serving" style="color: ${b.accentLight};">${b.baseUrl}/serving</a>.
      </p>
    `, b.orgName),
  });

  if (error) {
    console.error("Failed to send serving broadcast email:", error);
    throw error;
  }
}
