// The one email layout, and the reminder emails built on it. lib/email imports
// this file as well, so both sides render the same markup. It must stay free
// of imports: Deno needs ".ts" specifiers, which the app's TypeScript config
// refuses.
//
// Every member-, event- or admin-supplied string in email HTML must pass
// through escapeHtml: Resend sends the markup as-is. A helper's `html`
// parameter takes markup that has already been escaped; its other string
// parameters are plain text and are escaped here. `accent` is the exception:
// the HEX gate on both sides is its injection boundary.

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const EMAIL_COLORS = {
  page: "#F4EEE2",
  card: "#FBF7F0",
  panel: "#F3E7D9",
  rule: "#E8DECF",
  ink: "#2A211A",
  muted: "#5C5044",
  link: "#8A4227",
  onAccent: "#FFFFFF",
} as const;

const HEADING_FONT = "Fraunces, Georgia, 'Times New Roman', serif";
const BODY_FONT =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const BODY_TEXT = `font-size:18px;line-height:1.6;color:${EMAIL_COLORS.ink};`;
const SMALL_TEXT = `font-size:16px;line-height:1.5;color:${EMAIL_COLORS.muted};`;

/** The frame every email shares, signed with the church's name alone. */
export function emailLayout(orgName: string, html: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${EMAIL_COLORS.page};">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:${EMAIL_COLORS.card};border-radius:8px;">
        <tr>
          <td style="padding:32px 24px;font-family:${BODY_FONT};text-align:left;">
${html}
            <p style="${BODY_TEXT}margin:32px 0 0;">${escapeHtml(orgName)}</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}

export function heading(text: string): string {
  return `<h1 style="font-family:${HEADING_FONT};font-size:28px;line-height:1.25;font-weight:600;color:${EMAIL_COLORS.ink};margin:0 0 16px;">${escapeHtml(text)}</h1>`;
}

export function paragraph(html: string): string {
  return `<p style="${BODY_TEXT}margin:0 0 16px;">${html}</p>`;
}

export function smallPrint(html: string): string {
  return `<p style="${SMALL_TEXT}margin:24px 0 0;">${html}</p>`;
}

export function strong(text: string): string {
  return `<strong>${escapeHtml(text)}</strong>`;
}

export function link(href: string, text: string): string {
  return `<a href="${escapeHtml(href)}" style="color:${EMAIL_COLORS.link};word-break:break-word;">${escapeHtml(text)}</a>`;
}

export function button(href: string, label: string, accent: string): string {
  return `<a href="${escapeHtml(href)}" style="display:inline-block;background-color:${accent};color:${EMAIL_COLORS.onAccent};padding:14px 24px;text-decoration:none;border-radius:8px;font-size:18px;line-height:1.25;font-weight:600;white-space:nowrap;">${escapeHtml(label)}</a>`;
}

/** The set-apart box for the facts of an email: a date, a place, a message. */
export function panel(html: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${EMAIL_COLORS.panel};border-radius:8px;margin:0 0 16px;">
  <tr>
    <td style="padding:16px 20px;${BODY_TEXT}">${html}</td>
  </tr>
</table>`;
}

/** Lines for a panel, such as ["When", "Tuesday, November 10 at 7:00 PM"]. */
export function factLines(facts: [label: string, value: string][]): string {
  return facts
    .map(([label, value]) => `${strong(`${label}:`)} ${escapeHtml(value)}`)
    .join("<br />");
}

/** A button with the fallback a client that drops button styling still needs. */
export function primaryAction(href: string, label: string, accent: string): string {
  return `${button(href, label, accent)}
${smallPrint(`If the button doesn&#39;t work, copy and paste this link into your browser:<br />${link(href, href)}`)}`;
}

export function cancelTurn(cancelUrl: string, accent: string): string {
  return `${paragraph("Can&#39;t make it? Cancel your turn and the date opens up for someone else.")}
${button(cancelUrl, "Cancel my turn", accent)}`;
}

export function openDateRows(
  dates: { dateLabel: string; url: string }[],
  accent: string,
): string {
  return dates
    .map(
      ({ dateLabel, url }) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-bottom:1px solid ${EMAIL_COLORS.rule};">
  <tr>
    <td style="padding:12px 12px 12px 0;${BODY_TEXT}">${escapeHtml(dateLabel)}</td>
    <td align="right" style="padding:12px 0;">${button(url, "Sign up", accent)}</td>
  </tr>
</table>`,
    )
    .join("\n");
}

export function viewSchedule(scheduleUrl: string): string {
  return smallPrint(`See who is serving on each date: ${link(scheduleUrl, "View schedule")}`);
}

export interface RenderedEmail {
  subject: string;
  html: string;
}

export function servingReminderEmail(opts: {
  orgName: string;
  accent: string;
  name: string;
  teamName: string;
  dateLabel: string;
  cancelUrl: string;
}): RenderedEmail {
  return {
    subject: `Reminder: you're serving with ${opts.teamName} on ${opts.dateLabel}`,
    html: emailLayout(
      opts.orgName,
      `${heading("Serving reminder")}
${paragraph(`Hi ${escapeHtml(opts.name)}, you&#39;re signed up to serve with ${strong(opts.teamName)}.`)}
${panel(factLines([["When", opts.dateLabel]]))}
${cancelTurn(opts.cancelUrl, opts.accent)}`,
    ),
  };
}

export function openDatesEmail(opts: {
  orgName: string;
  accent: string;
  name: string;
  teamName: string;
  dates: { dateLabel: string; url: string }[];
  scheduleUrl: string;
}): RenderedEmail {
  return {
    subject: `${opts.teamName}: dates that still need someone`,
    html: emailLayout(
      opts.orgName,
      `${heading("Can you take one of these dates?")}
${paragraph(`Hi ${escapeHtml(opts.name)}, these dates for ${strong(opts.teamName)} still need someone. Choose a date to sign up.`)}
${openDateRows(opts.dates, opts.accent)}
${viewSchedule(opts.scheduleUrl)}`,
    ),
  };
}

export function eventReminderEmail(opts: {
  orgName: string;
  accent: string;
  name: string;
  title: string;
  dateLabel: string;
  location: string | null;
  eventUrl: string;
}): RenderedEmail {
  const facts: [string, string][] = [["When", opts.dateLabel]];
  if (opts.location) facts.push(["Where", opts.location]);
  return {
    subject: `Reminder: ${opts.title} on ${opts.dateLabel}`,
    html: emailLayout(
      opts.orgName,
      `${heading("Event reminder")}
${paragraph(`Hi ${escapeHtml(opts.name)}, ${strong(opts.title)} is coming up.`)}
${panel(factLines(facts))}
${button(opts.eventUrl, "View event", opts.accent)}`,
    ),
  };
}
